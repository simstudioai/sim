import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl, getSocketServerUrl } from '@/lib/core/utils/urls'
import { removeMcpToolsForWorkflow, syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  cleanupWebhooksForWorkflow,
  restorePreviousVersionWebhooks,
  saveTriggerWebhooksForDeploy,
} from '@/lib/webhooks/deploy'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'
import {
  activateWorkflowVersion,
  activateWorkflowVersionById,
  deployWorkflow,
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import {
  cleanupDeploymentVersion,
  createSchedulesForDeploy,
  validateWorkflowSchedules,
} from '@/lib/workflows/schedules'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployOrchestration')

/**
 * Notifies the socket server that a workflow's deployment state has changed,
 * so all connected clients can refresh their deployment queries.
 */
export async function notifySocketDeploymentChanged(workflowId: string): Promise<void> {
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
 * Performs a full workflow deployment: creates a deployment version, syncs
 * trigger webhooks, creates schedules, cleans up the previous version, and
 * syncs MCP tools. Both the deploy API route and the copilot deploy tools
 * must use this single function so behaviour stays consistent.
 */
export async function performFullDeploy(
  params: PerformFullDeployParams
): Promise<PerformFullDeployResult> {
  const { workflowId, userId, workflowName } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()
  const request = params.request ?? new NextRequest(new URL('/api/webhooks', getBaseUrl()))

  const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalizedData) {
    return { success: false, error: 'Failed to load workflow state', errorCode: 'not_found' }
  }

  const scheduleValidation = validateWorkflowSchedules(normalizedData.blocks)
  if (!scheduleValidation.isValid) {
    return {
      success: false,
      error: `Invalid schedule configuration: ${scheduleValidation.error}`,
      errorCode: 'validation',
    }
  }

  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  const workflowData = workflowRecord as Record<string, unknown>

  const [currentActiveVersion] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  const previousVersionId = currentActiveVersion?.id

  const rollbackDeployment = async () => {
    if (previousVersionId) {
      await restorePreviousVersionWebhooks({
        request,
        workflow: workflowData,
        userId,
        previousVersionId,
        requestId,
      })
      const reactivateResult = await activateWorkflowVersionById({
        workflowId,
        deploymentVersionId: previousVersionId,
      })
      if (reactivateResult.success) return
    }
    await undeployWorkflow({ workflowId })
  }

  const deployResult = await deployWorkflow({
    workflowId,
    deployedBy: actorId,
    workflowName: workflowName || workflowRecord.name || undefined,
  })

  if (!deployResult.success) {
    return { success: false, error: deployResult.error || 'Failed to deploy workflow' }
  }

  const deployedAt = deployResult.deployedAt!
  const deploymentVersionId = deployResult.deploymentVersionId

  if (!deploymentVersionId) {
    await undeployWorkflow({ workflowId })
    return { success: false, error: 'Failed to resolve deployment version' }
  }

  const triggerSaveResult = await saveTriggerWebhooksForDeploy({
    request,
    workflowId,
    workflow: workflowData,
    userId,
    blocks: normalizedData.blocks,
    requestId,
    deploymentVersionId,
    previousVersionId,
  })

  if (!triggerSaveResult.success) {
    await cleanupDeploymentVersion({
      workflowId,
      workflow: workflowData,
      requestId,
      deploymentVersionId,
    })
    await rollbackDeployment()
    return {
      success: false,
      error: triggerSaveResult.error?.message || 'Failed to save trigger configuration',
    }
  }

  const scheduleResult = await createSchedulesForDeploy(
    workflowId,
    normalizedData.blocks,
    db,
    deploymentVersionId
  )
  if (!scheduleResult.success) {
    logger.error(`[${requestId}] Failed to create schedule: ${scheduleResult.error}`)
    await cleanupDeploymentVersion({
      workflowId,
      workflow: workflowData,
      requestId,
      deploymentVersionId,
    })
    await rollbackDeployment()
    return { success: false, error: scheduleResult.error || 'Failed to create schedule' }
  }

  if (previousVersionId && previousVersionId !== deploymentVersionId) {
    try {
      await cleanupDeploymentVersion({
        workflowId,
        workflow: workflowData,
        requestId,
        deploymentVersionId: previousVersionId,
        skipExternalCleanup: true,
      })
    } catch (cleanupError) {
      logger.error(`[${requestId}] Failed to clean up previous version`, cleanupError)
    }
  }

  await syncMcpToolsForWorkflow({ workflowId, requestId, context: 'deploy' })

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
      triggerWarnings: triggerSaveResult.warnings?.length ? triggerSaveResult.warnings : undefined,
    },
    request,
  })

  await notifySocketDeploymentChanged(workflowId)

  return {
    success: true,
    deployedAt,
    version: deployResult.version,
    deploymentVersionId,
    warnings: triggerSaveResult.warnings,
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
}

/**
 * Performs a full workflow undeploy: marks the workflow as undeployed, cleans up
 * webhook records and external subscriptions, removes MCP tools, emits a
 * telemetry event, and records an audit log entry. Both the deploy API DELETE
 * handler and the copilot undeploy tools must use this single function.
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

  const result = await undeployWorkflow({ workflowId })
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to undeploy workflow' }
  }

  await cleanupWebhooksForWorkflow(workflowId, workflowData, requestId)
  await removeMcpToolsForWorkflow(workflowId, requestId)

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

  return { success: true }
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
 * Activates an existing deployment version: validates schedules, syncs trigger
 * webhooks (with forced subscription recreation), creates schedules, activates
 * the version, cleans up the previous version, syncs MCP tools, and records
 * an audit entry. Both the deployment version PATCH handler and the admin
 * activate route must use this function.
 */
export async function performActivateVersion(
  params: PerformActivateVersionParams
): Promise<PerformActivateVersionResult> {
  const { workflowId, version, userId, workflow } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()
  const request = params.request ?? new NextRequest(new URL('/api/webhooks', getBaseUrl()))

  const [versionRow] = await db
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
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

  const deployedState = versionRow.state as { blocks?: Record<string, unknown> }
  const blocks = deployedState.blocks
  if (!blocks || typeof blocks !== 'object') {
    return { success: false, error: 'Invalid deployed state structure', errorCode: 'validation' }
  }

  const [currentActiveVersion] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  const previousVersionId = currentActiveVersion?.id

  const scheduleValidation = validateWorkflowSchedules(
    blocks as Record<string, import('@/stores/workflows/workflow/types').BlockState>
  )
  if (!scheduleValidation.isValid) {
    return {
      success: false,
      error: `Invalid schedule configuration: ${scheduleValidation.error}`,
      errorCode: 'validation',
    }
  }

  const triggerSaveResult = await saveTriggerWebhooksForDeploy({
    request,
    workflowId,
    workflow,
    userId,
    blocks: blocks as Record<string, import('@/stores/workflows/workflow/types').BlockState>,
    requestId,
    deploymentVersionId: versionRow.id,
    previousVersionId,
    forceRecreateSubscriptions: true,
  })

  if (!triggerSaveResult.success) {
    if (previousVersionId) {
      await restorePreviousVersionWebhooks({
        request,
        workflow,
        userId,
        previousVersionId,
        requestId,
      })
    }
    return {
      success: false,
      error: triggerSaveResult.error?.message || 'Failed to sync trigger configuration',
    }
  }

  const scheduleResult = await createSchedulesForDeploy(
    workflowId,
    blocks as Record<string, import('@/stores/workflows/workflow/types').BlockState>,
    db,
    versionRow.id
  )

  if (!scheduleResult.success) {
    await cleanupDeploymentVersion({
      workflowId,
      workflow,
      requestId,
      deploymentVersionId: versionRow.id,
    })
    if (previousVersionId) {
      await restorePreviousVersionWebhooks({
        request,
        workflow,
        userId,
        previousVersionId,
        requestId,
      })
    }
    return { success: false, error: scheduleResult.error || 'Failed to sync schedules' }
  }

  const result = await activateWorkflowVersion({ workflowId, version })
  if (!result.success) {
    await cleanupDeploymentVersion({
      workflowId,
      workflow,
      requestId,
      deploymentVersionId: versionRow.id,
    })
    if (previousVersionId) {
      await restorePreviousVersionWebhooks({
        request,
        workflow,
        userId,
        previousVersionId,
        requestId,
      })
    }
    return { success: false, error: result.error || 'Failed to activate version' }
  }

  if (previousVersionId && previousVersionId !== versionRow.id) {
    try {
      await cleanupDeploymentVersion({
        workflowId,
        workflow,
        requestId,
        deploymentVersionId: previousVersionId,
        skipExternalCleanup: true,
      })
    } catch (cleanupError) {
      logger.error(`[${requestId}] Failed to clean up previous version`, cleanupError)
    }
  }

  await syncMcpToolsForWorkflow({
    workflowId,
    requestId,
    state: versionRow.state as { blocks?: Record<string, unknown> },
    context: 'activate',
  })

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
      previousVersionId: previousVersionId || undefined,
    },
  })

  await notifySocketDeploymentChanged(workflowId)

  return {
    success: true,
    deployedAt: result.deployedAt,
    warnings: triggerSaveResult.warnings,
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

  let stateRow: { state: unknown } | null = null
  if (version === 'active') {
    const [row] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)
    stateRow = row || null
  } else {
    const [row] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, version)
        )
      )
      .limit(1)
    stateRow = row || null
  }

  if (!stateRow?.state) {
    return { success: false, error: 'Deployment version not found', errorCode: 'not_found' }
  }

  const deployedState = stateRow.state as {
    blocks?: Record<string, unknown>
    edges?: unknown[]
    loops?: Record<string, unknown>
    parallels?: Record<string, unknown>
  }
  if (!deployedState.blocks || !deployedState.edges) {
    return {
      success: false,
      error: 'Invalid deployed state structure',
      errorCode: 'internal',
    }
  }

  const lastSaved = Date.now()
  const saveResult = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: deployedState.blocks,
    edges: deployedState.edges,
    loops: deployedState.loops || {},
    parallels: deployedState.parallels || {},
    lastSaved,
  } as WorkflowState)

  if (!saveResult.success) {
    return {
      success: false,
      error: saveResult.error || 'Failed to save deployed state',
      errorCode: 'internal',
    }
  }

  await db
    .update(workflowTable)
    .set({ lastSynced: new Date(), updatedAt: new Date() })
    .where(eq(workflowTable.id, workflowId))

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
