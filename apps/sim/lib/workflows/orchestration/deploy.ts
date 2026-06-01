import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/workflow-authz'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import { captureServerEvent } from '@/lib/posthog/server'
import { validateTriggerWebhookConfigForDeploy } from '@/lib/webhooks/deploy'
import {
  enqueueWorkflowDeploymentSideEffects,
  enqueueWorkflowUndeploySideEffects,
  processWorkflowDeploymentOutboxEvent,
} from '@/lib/workflows/deployment-outbox'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'
import {
  activateWorkflowVersion,
  deployWorkflow,
  saveWorkflowToNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import { validateWorkflowSchedules } from '@/lib/workflows/schedules'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployOrchestration')

/**
 * Notifies the socket server that a workflow's deployment state has changed,
 * so all connected clients can refresh their deployment queries.
 */
async function notifySocketDeploymentChanged(workflowId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workflow-deployed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId }),
    })
    if (!response.ok) {
      logger.warn(
        `Socket deployment notification failed (${response.status}) for workflow ${workflowId}`
      )
    }
  } catch (error) {
    logger.error('Error sending workflow deployed event to socket server', error)
  }
}

export interface PerformFullDeployParams {
  workflowId: string
  userId: string
  workflowName?: string
  requestId?: string
  /**
   * Optional NextRequest for external webhook subscriptions.
   * If not provided, a synthetic request is constructed from the base URL.
   */
  request?: NextRequest
  /**
   * Override the actor ID used in audit logs and the `deployedBy` field.
   * Defaults to `userId`. Use `'admin-api'` for admin-initiated actions.
   */
  actorId?: string
}

export interface PerformFullDeployResult {
  success: boolean
  deployedAt?: Date
  version?: number
  deploymentVersionId?: string
  error?: string
  errorCode?: OrchestrationErrorCode
  warnings?: string[]
}

/**
 * Performs a full workflow deployment: creates a deployment version, queues
 * external side effects transactionally, processes that outbox event after
 * commit, and notifies clients. Both the deploy API route and the copilot
 * deploy tools must use this single function so behaviour stays consistent.
 */
export async function performFullDeploy(
  params: PerformFullDeployParams
): Promise<PerformFullDeployResult> {
  const { workflowId, userId, workflowName } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()

  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  const workflowData = workflowRecord as Record<string, unknown>
  let outboxEventId: string | undefined

  const deployResult = await deployWorkflow({
    workflowId,
    deployedBy: actorId,
    workflowName: workflowName || workflowRecord.name || undefined,
    validateWorkflowState: async (workflowState) => {
      const scheduleValidation = validateWorkflowSchedules(workflowState.blocks)
      if (!scheduleValidation.isValid) {
        return {
          success: false,
          error: `Invalid schedule configuration: ${scheduleValidation.error}`,
          errorCode: 'validation',
        }
      }
      const triggerValidation = await validateTriggerWebhookConfigForDeploy(workflowState.blocks)
      if (!triggerValidation.success) {
        return {
          success: false,
          error: triggerValidation.error?.message || 'Invalid trigger configuration',
          errorCode: 'validation',
        }
      }
      return { success: true }
    },
    onDeployTransaction: async (tx, result) => {
      outboxEventId = await enqueueWorkflowDeploymentSideEffects(tx, {
        workflowId,
        deploymentVersionId: result.deploymentVersionId,
        userId,
        requestId,
      })
    },
  })

  if (!deployResult.success) {
    const error = deployResult.error || 'Failed to deploy workflow'
    return {
      success: false,
      error,
      errorCode: deployResult.errorCode,
    }
  }

  const deployedAt = deployResult.deployedAt!
  const deploymentVersionId = deployResult.deploymentVersionId
  const previousVersionId = deployResult.previousVersionId
  const deploymentSnapshot = deployResult.currentState

  if (!deploymentVersionId || !deploymentSnapshot) {
    await undeployWorkflow({ workflowId })
    return { success: false, error: 'Failed to resolve deployment version' }
  }

  recordAudit({
    workspaceId: (workflowData.workspaceId as string) || null,
    actorId: actorId,
    action: AuditAction.WORKFLOW_DEPLOYED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: (workflowData.name as string) || undefined,
    description: `Deployed workflow "${(workflowData.name as string) || workflowId}"`,
    metadata: {
      deploymentVersionId,
      version: deployResult.version,
      previousVersionId: previousVersionId || undefined,
    },
    request: params.request,
  })

  const sideEffectWarning = await processDeploymentSideEffectsNow(outboxEventId, requestId)
  await notifySocketDeploymentChanged(workflowId)

  return {
    success: true,
    deployedAt,
    version: deployResult.version,
    deploymentVersionId,
    warnings: sideEffectWarning ? [sideEffectWarning] : undefined,
  }
}

export interface PerformFullUndeployParams {
  workflowId: string
  userId: string
  requestId?: string
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
}

export interface PerformFullUndeployResult {
  success: boolean
  error?: string
  warnings?: string[]
}

/**
 * Performs a full workflow undeploy: marks the workflow as undeployed, queues
 * external cleanup transactionally, emits a telemetry event, and records an
 * audit log entry. Both the deploy API DELETE handler and the copilot undeploy
 * tools must use this single function.
 */
export async function performFullUndeploy(
  params: PerformFullUndeployParams
): Promise<PerformFullUndeployResult> {
  const { workflowId, userId } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()

  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return { success: false, error: 'Workflow not found' }
  }

  const workflowData = workflowRecord as Record<string, unknown>
  let outboxEventId: string | undefined

  const result = await undeployWorkflow({
    workflowId,
    onUndeployTransaction: async (tx, undeploy) => {
      outboxEventId = await enqueueWorkflowUndeploySideEffects(tx, {
        workflowId,
        deploymentVersionIds: undeploy.deploymentVersionIds,
        userId,
        requestId,
      })
    },
  })
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to undeploy workflow' }
  }

  logger.info(`[${requestId}] Workflow undeployed successfully: ${workflowId}`)

  try {
    const { PlatformEvents } = await import('@/lib/core/telemetry')
    PlatformEvents.workflowUndeployed({ workflowId })
  } catch (_e) {
    // Telemetry is best-effort
  }

  recordAudit({
    workspaceId: (workflowData.workspaceId as string) || null,
    actorId: actorId,
    action: AuditAction.WORKFLOW_UNDEPLOYED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: (workflowData.name as string) || undefined,
    description: `Undeployed workflow "${(workflowData.name as string) || workflowId}"`,
  })

  await notifySocketDeploymentChanged(workflowId)
  const sideEffectWarning = await processDeploymentSideEffectsNow(outboxEventId, requestId)

  return { success: true, warnings: sideEffectWarning ? [sideEffectWarning] : undefined }
}

export interface PerformActivateVersionParams {
  workflowId: string
  version: number
  userId: string
  workflow: Record<string, unknown>
  requestId?: string
  request?: NextRequest
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
}

export interface PerformActivateVersionResult {
  success: boolean
  deployedAt?: Date
  error?: string
  errorCode?: OrchestrationErrorCode
  warnings?: string[]
}

export interface PerformRevertToVersionParams {
  workflowId: string
  version: number | 'active'
  userId: string
  workflow: Record<string, unknown>
  request?: NextRequest
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
  actorName?: string
  actorEmail?: string
}

export interface PerformRevertToVersionResult {
  success: boolean
  lastSaved?: number
  error?: string
  errorCode?: OrchestrationErrorCode
}

/**
 * Activates an existing deployment version: validates schedules, activates the
 * version, queues external side effects transactionally, processes that outbox
 * event after commit, and records an audit entry. Both the deployment version
 * PATCH handler and the admin activate route must use this function.
 */
export async function performActivateVersion(
  params: PerformActivateVersionParams
): Promise<PerformActivateVersionResult> {
  const { workflowId, version, userId, workflow } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()

  const [versionRow] = await db
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
      isActive: workflowDeploymentVersion.isActive,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.version, version)
      )
    )
    .limit(1)

  if (!versionRow?.state) {
    return { success: false, error: 'Deployment version not found', errorCode: 'not_found' }
  }

  if (versionRow.isActive) {
    const [workflowDeployment] = await db
      .select({ deployedAt: workflowTable.deployedAt })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    return { success: true, deployedAt: workflowDeployment?.deployedAt ?? new Date(), warnings: [] }
  }

  const deployedState = versionRow.state as { blocks?: Record<string, unknown> }
  const blocks = deployedState.blocks
  if (!blocks || typeof blocks !== 'object') {
    return { success: false, error: 'Invalid deployed state structure', errorCode: 'validation' }
  }

  const scheduleValidation = validateWorkflowSchedules(blocks as Record<string, BlockState>)
  if (!scheduleValidation.isValid) {
    return {
      success: false,
      error: `Invalid schedule configuration: ${scheduleValidation.error}`,
      errorCode: 'validation',
    }
  }

  const triggerValidation = await validateTriggerWebhookConfigForDeploy(
    blocks as Record<string, BlockState>
  )
  if (!triggerValidation.success) {
    return {
      success: false,
      error: triggerValidation.error?.message || 'Invalid trigger configuration',
      errorCode: 'validation',
    }
  }

  let outboxEventId: string | undefined
  const result = await activateWorkflowVersion({
    workflowId,
    version,
    onActivateTransaction: async (tx, activation) => {
      outboxEventId = await enqueueWorkflowDeploymentSideEffects(tx, {
        workflowId,
        deploymentVersionId: activation.deploymentVersionId,
        userId,
        requestId,
        forceRecreateSubscriptions: true,
      })
    },
  })
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to activate version' }
  }

  recordAudit({
    workspaceId: (workflow.workspaceId as string) || null,
    actorId: actorId,
    action: AuditAction.WORKFLOW_DEPLOYMENT_ACTIVATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    description: `Activated deployment version ${version}`,
    resourceName: (workflow.name as string) || undefined,
    metadata: {
      version,
      deploymentVersionId: versionRow.id,
      previousVersionId: result.previousVersionId || undefined,
    },
  })

  const sideEffectWarning = await processDeploymentSideEffectsNow(outboxEventId, requestId)
  await notifySocketDeploymentChanged(workflowId)

  return {
    success: true,
    deployedAt: result.deployedAt,
    warnings: sideEffectWarning ? [sideEffectWarning] : undefined,
  }
}

async function processDeploymentSideEffectsNow(
  outboxEventId: string | undefined,
  requestId: string
): Promise<string | undefined> {
  if (!outboxEventId) {
    return 'Deployment state changed, but side-effect sync was not queued. Redeploy if triggers or schedules look stale.'
  }

  try {
    const result = await processWorkflowDeploymentOutboxEvent(outboxEventId)
    if (result === 'completed') return undefined
    if (result === 'dead_letter' || result === 'not_found') {
      logger.error(`[${requestId}] Deployment side-effect sync cannot be retried automatically`, {
        outboxEventId,
        result,
      })
      return 'Deployment saved, but trigger, schedule, and MCP sync could not be queued. Redeploy if triggers or schedules look stale.'
    }

    logger.warn(`[${requestId}] Deployment side-effect sync queued for retry`, {
      outboxEventId,
      result,
    })
    return 'Deployment saved. Trigger, schedule, and MCP sync is queued and may finish shortly.'
  } catch (error) {
    logger.warn(`[${requestId}] Deployment side-effect sync queued for retry`, {
      outboxEventId,
      error,
    })
    return 'Deployment saved. Trigger, schedule, and MCP sync is queued and may finish shortly.'
  }
}

/**
 * Reverts the current workflow draft to match a saved deployment version.
 * This matches the deployment modal's "load deployment" behavior and is used
 * by both the HTTP route and the mothership tool handler.
 */
export async function performRevertToVersion(
  params: PerformRevertToVersionParams
): Promise<PerformRevertToVersionResult> {
  const { workflowId, version, userId, workflow } = params
  const actorId = params.actorId ?? userId
  const versionLabel = String(version)

  const lastSaved = Date.now()
  let saveResult: { success: boolean; error?: string; errorCode?: OrchestrationErrorCode }
  try {
    await assertWorkflowMutable(workflowId)
    saveResult = await db.transaction(async (tx) => {
      await tx
        .select({ id: workflowTable.id })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
        .for('update')

      const [stateRow] =
        version === 'active'
          ? await tx
              .select({ state: workflowDeploymentVersion.state })
              .from(workflowDeploymentVersion)
              .where(
                and(
                  eq(workflowDeploymentVersion.workflowId, workflowId),
                  eq(workflowDeploymentVersion.isActive, true)
                )
              )
              .limit(1)
          : await tx
              .select({ state: workflowDeploymentVersion.state })
              .from(workflowDeploymentVersion)
              .where(
                and(
                  eq(workflowDeploymentVersion.workflowId, workflowId),
                  eq(workflowDeploymentVersion.version, version)
                )
              )
              .limit(1)

      if (!stateRow?.state) {
        return { success: false, error: 'Deployment version not found' }
      }

      const deployedState = stateRow.state as {
        blocks?: Record<string, unknown>
        edges?: unknown[]
        loops?: Record<string, unknown>
        parallels?: Record<string, unknown>
        variables?: WorkflowState['variables']
      }
      if (!deployedState.blocks || !deployedState.edges) {
        return { success: false, error: 'Invalid deployed state structure' }
      }

      const hasDeploymentVariables = Object.hasOwn(deployedState, 'variables')
      const restoredState: WorkflowState = {
        blocks: deployedState.blocks,
        edges: deployedState.edges,
        loops: deployedState.loops || {},
        parallels: deployedState.parallels || {},
        lastSaved,
      } as WorkflowState
      if (hasDeploymentVariables) {
        restoredState.variables = deployedState.variables || {}
      }

      const result = await saveWorkflowToNormalizedTables(workflowId, restoredState, tx)
      if (!result.success) return result

      await tx
        .update(workflowTable)
        .set({
          ...(hasDeploymentVariables ? { variables: deployedState.variables || {} } : {}),
          lastSynced: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowTable.id, workflowId))

      return result
    })
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      return { success: false, error: error.message, errorCode: 'validation' }
    }
    throw error
  }

  if (!saveResult.success) {
    return {
      success: false,
      error: saveResult.error || 'Failed to save deployed state',
      errorCode:
        saveResult.error === 'Deployment version not found'
          ? 'not_found'
          : saveResult.error === 'Invalid deployed state structure'
            ? 'internal'
            : 'internal',
    }
  }

  try {
    await fetch(`${getSocketServerUrl()}/api/workflow-reverted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId, timestamp: lastSaved }),
    })
  } catch (error) {
    logger.error('Error sending workflow reverted event to socket server', error)
  }

  const workspaceId = (workflow.workspaceId as string) || ''
  captureServerEvent(
    userId,
    'workflow_deployment_reverted',
    {
      workflow_id: workflowId,
      workspace_id: workspaceId,
      version: versionLabel,
    },
    workspaceId ? { groups: { workspace: workspaceId } } : undefined
  )

  recordAudit({
    workspaceId: workspaceId || null,
    actorId,
    actorName: params.actorName,
    actorEmail: params.actorEmail,
    action: AuditAction.WORKFLOW_DEPLOYMENT_REVERTED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: (workflow.name as string) || undefined,
    description: `Reverted workflow to deployment version ${versionLabel}`,
    metadata: {
      targetVersion: versionLabel,
    },
    request: params.request,
  })

  return {
    success: true,
    lastSaved,
  }
}
