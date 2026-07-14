import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import { captureServerEvent } from '@/lib/posthog/server'
import { validateTriggerWebhookConfigForDeploy } from '@/lib/webhooks/deploy'
import {
  type DeploymentComponentStatus,
  isDeploymentOperationAction,
  isDeploymentOperationStatus,
  parseDeploymentReadiness,
} from '@/lib/workflows/deployment-lifecycle'
import {
  DEPLOYMENT_READINESS_COMPONENTS,
  enqueueWorkflowDeploymentPreparation,
  enqueueWorkflowUndeploySideEffects,
  notifySocketDeploymentChanged,
  processWorkflowDeploymentOutboxEvent,
} from '@/lib/workflows/deployment-outbox'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'
import {
  getWorkflowDeploymentStatus,
  prepareWorkflowDeployment,
  prepareWorkflowVersionActivation,
  type WorkflowDeploymentOperation,
  type WorkflowDeploymentStatus,
} from '@/lib/workflows/persistence/deployment-operations'
import {
  loadWorkflowDeploymentSnapshot,
  saveWorkflowToNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import { validateWorkflowSchedules } from '@/lib/workflows/schedules'
import { emitWorkflowUndeployedEvent } from '@/lib/workspace-events/emitter'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployOrchestration')

type DeploymentReadinessSummaryStatus = DeploymentComponentStatus | 'not_applicable'

export interface ActiveDeploymentResult {
  deploymentVersionId: string
  version: number
  deployedAt: string
}

export interface DeploymentAttemptResult {
  id: string
  deploymentVersionId: string
  version: number
  action: 'deploy' | 'activate'
  status: 'preparing' | 'activating' | 'active' | 'failed' | 'superseded'
  readiness: {
    webhooks: DeploymentReadinessSummaryStatus
    schedules: DeploymentReadinessSummaryStatus
    mcp: DeploymentReadinessSummaryStatus
  }
  requestedAt: string
  activatedAt?: string | null
  error?: {
    code: string
    message: string
    retryable: boolean
  } | null
}

export interface PerformFullDeployParams {
  workflowId: string
  userId: string
  /**
   * Optional summary of what changed, stored on the created deployment version.
   * The copilot deploy tools require this; the UI deploy route sets it
   * separately via the version metadata endpoint, so it stays optional here.
   */
  versionDescription?: string
  /**
   * Optional name/label for the created deployment version. The copilot deploy
   * tools require this; the UI deploy route sets it via the version metadata
   * endpoint, so it stays optional here.
   */
  versionName?: string
  requestId?: string
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
  activeDeployment?: ActiveDeploymentResult | null
  latestDeploymentAttempt?: DeploymentAttemptResult | null
  error?: string
  errorCode?: OrchestrationErrorCode
  warnings?: string[]
}

/**
 * Admits a deployment through the v2 prepare/activate protocol. The candidate
 * version remains inactive until every required side effect is ready.
 */
export async function performFullDeploy(
  params: PerformFullDeployParams
): Promise<PerformFullDeployResult> {
  const { workflowId, userId } = params
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

  try {
    return await performStableFullDeploy({
      params,
      actorId,
      requestId,
    })
  } catch (error) {
    logger.error(`[${requestId}] Deployment preparation failed`, { workflowId, error })
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to prepare workflow deployment'),
      errorCode: 'internal',
    }
  }
}

async function performStableFullDeploy(params: {
  params: PerformFullDeployParams
  actorId: string
  requestId: string
}): Promise<PerformFullDeployResult> {
  const workflowState = await loadWorkflowDeploymentSnapshot(params.params.workflowId)
  if (!workflowState) {
    return {
      success: false,
      error: 'Failed to load workflow state',
      errorCode: 'validation',
    }
  }

  const validation = await validateDeploymentState(workflowState.blocks)
  if (!validation.success) return validation

  let outboxEventId: string | undefined
  const prepared = await prepareWorkflowDeployment({
    workflowId: params.params.workflowId,
    actorId: params.actorId,
    requestHash: createDeploymentRequestHash({
      action: 'deploy',
      workflowId: params.params.workflowId,
      userId: params.params.userId,
      workflowState,
      versionName: params.params.versionName ?? null,
      versionDescription: params.params.versionDescription ?? null,
    }),
    idempotencyKey: params.requestId,
    workflowState,
    name: params.params.versionName,
    description: params.params.versionDescription,
    readinessComponents: DEPLOYMENT_READINESS_COMPONENTS,
    onPrepareTransaction: async (tx, operation) => {
      if (!operation.deploymentVersionId || operation.version === null) {
        throw new Error('Prepared deployment operation is missing its target version')
      }
      outboxEventId = await enqueueWorkflowDeploymentPreparation(tx, {
        protocolVersion: operation.protocolVersion,
        operationId: operation.id,
        generation: operation.generation,
        workflowId: operation.workflowId,
        deploymentVersionId: operation.deploymentVersionId,
        version: operation.version,
        userId: params.params.userId,
        requestId: params.requestId,
        checkpoints: {},
      })
    },
  })

  if (!prepared.success) {
    return {
      success: false,
      error: prepared.error,
      errorCode: mapPrepareFailureCode(prepared.reason),
    }
  }

  const processResult = await processStableDeploymentPreparationNow(outboxEventId, params.requestId)
  const deploymentStatus = await getWorkflowDeploymentStatus(params.params.workflowId)
  const inlineFailure = buildInlinePreparationFailure(prepared.operation.id, deploymentStatus)
  if (inlineFailure) return inlineFailure
  return buildStableDeploymentResult(deploymentStatus, processResult)
}

/**
 * Surfaces a synchronous failure when the attempt created by this request
 * already failed terminally, so callers get an error response instead of a
 * success payload with a buried failed status.
 */
function buildInlinePreparationFailure(
  operationId: string,
  status: WorkflowDeploymentStatus
): { success: false; error: string; errorCode: OrchestrationErrorCode } | null {
  const latest = status.latestOperation
  if (!latest || latest.id !== operationId || latest.status !== 'failed') return null
  return {
    success: false,
    error: latest.errorMessage || 'Deployment preparation failed',
    errorCode:
      latest.errorCode === 'webhook_path_conflict'
        ? 'conflict'
        : latest.errorCode === 'invalid_trigger_configuration'
          ? 'validation'
          : 'internal',
  }
}

async function validateDeploymentState(
  blocks: Record<string, BlockState>
): Promise<
  | { success: true }
  | { success: false; error: string; errorCode: Extract<OrchestrationErrorCode, 'validation'> }
> {
  const scheduleValidation = validateWorkflowSchedules(blocks)
  if (!scheduleValidation.isValid) {
    return {
      success: false,
      error: `Invalid schedule configuration: ${scheduleValidation.error}`,
      errorCode: 'validation',
    }
  }
  const triggerValidation = await validateTriggerWebhookConfigForDeploy(blocks)
  if (!triggerValidation.success) {
    return {
      success: false,
      error: triggerValidation.error?.message || 'Invalid trigger configuration',
      errorCode: 'validation',
    }
  }
  return { success: true }
}

function createDeploymentRequestHash(value: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(value))
}

function mapPrepareFailureCode(
  reason:
    | 'workflow_not_found'
    | 'workflow_archived'
    | 'deployment_version_not_found'
    | 'idempotency_conflict'
    | 'invalid_request'
): OrchestrationErrorCode {
  if (reason === 'workflow_not_found' || reason === 'deployment_version_not_found') {
    return 'not_found'
  }
  if (reason === 'idempotency_conflict') return 'conflict'
  return 'validation'
}

async function processStableDeploymentPreparationNow(
  outboxEventId: string | undefined,
  requestId: string
): Promise<string | undefined> {
  if (!outboxEventId) return undefined
  try {
    return await processWorkflowDeploymentOutboxEvent(outboxEventId)
  } catch (error) {
    logger.warn(`[${requestId}] Inline deployment preparation errored; outbox will retry`, {
      outboxEventId,
      error,
    })
    return 'processing_error'
  }
}

function buildStableDeploymentResult(
  status: WorkflowDeploymentStatus,
  processResult: string | undefined
): PerformFullDeployResult {
  const activeDeployment = status.activeDeployment
    ? {
        deploymentVersionId: status.activeDeployment.deploymentVersionId,
        version: status.activeDeployment.version,
        deployedAt: status.activeDeployment.deployedAt.toISOString(),
      }
    : null
  const latestDeploymentAttempt = summarizeDeploymentOperation(status.latestOperation)
  const warning = getStableDeploymentWarning(
    latestDeploymentAttempt,
    processResult,
    activeDeployment !== null
  )

  return {
    success: true,
    deployedAt: status.activeDeployment?.deployedAt,
    version: status.activeDeployment?.version,
    deploymentVersionId: status.activeDeployment?.deploymentVersionId,
    activeDeployment,
    latestDeploymentAttempt,
    warnings: warning ? [warning] : undefined,
  }
}

/**
 * Returns the active deployment and latest attempt without mutating deployment state.
 */
export async function getWorkflowDeploymentSummary(workflowId: string): Promise<{
  activeDeployment: ActiveDeploymentResult | null
  latestDeploymentAttempt: DeploymentAttemptResult | null
  warnings?: string[]
}> {
  const result = buildStableDeploymentResult(
    await getWorkflowDeploymentStatus(workflowId),
    undefined
  )
  return {
    activeDeployment: result.activeDeployment ?? null,
    latestDeploymentAttempt: result.latestDeploymentAttempt ?? null,
    warnings: result.warnings,
  }
}

function summarizeDeploymentOperation(
  operation: WorkflowDeploymentOperation | null
): DeploymentAttemptResult | null {
  if (!operation) return null
  if (
    !isDeploymentOperationAction(operation.action) ||
    !isDeploymentOperationStatus(operation.status)
  ) {
    return null
  }
  const readiness = parseDeploymentReadiness(operation.componentReadiness)
  const componentStatus = (
    component: (typeof DEPLOYMENT_READINESS_COMPONENTS)[number]
  ): DeploymentReadinessSummaryStatus => readiness?.[component]?.status ?? 'not_applicable'

  return {
    id: operation.id,
    deploymentVersionId: operation.deploymentVersionId,
    version: operation.version,
    action: operation.action,
    status: operation.status,
    readiness: {
      webhooks: componentStatus('webhooks'),
      schedules: componentStatus('schedules'),
      mcp: componentStatus('mcp'),
    },
    requestedAt: operation.createdAt.toISOString(),
    activatedAt:
      operation.status === 'active' ? (operation.completedAt?.toISOString() ?? null) : null,
    error:
      operation.errorCode && operation.errorMessage
        ? {
            code: operation.errorCode,
            message: operation.errorMessage,
            retryable: false,
          }
        : null,
  }
}

function getStableDeploymentWarning(
  attempt: DeploymentAttemptResult | null,
  processResult: string | undefined,
  hasActiveDeployment: boolean
): string | undefined {
  if (!attempt) return undefined
  if (attempt.status === 'preparing' || attempt.status === 'activating') {
    if (processResult === 'processing_error') {
      return hasActiveDeployment
        ? 'Deployment preparation hit an error and will retry automatically. The prior workflow version remains active until cutover.'
        : 'Deployment preparation hit an error and will retry automatically. The workflow remains undeployed until activation.'
    }
    return hasActiveDeployment
      ? 'Deployment preparation is queued and may finish shortly. The prior workflow version remains active until cutover.'
      : 'Deployment preparation is queued and may finish shortly. The workflow remains undeployed until activation.'
  }
  if (attempt.status === 'failed') {
    return hasActiveDeployment
      ? 'Deployment preparation failed. The prior workflow version remains active.'
      : 'Deployment preparation failed. The workflow remains undeployed.'
  }
  if (attempt.status === 'superseded') {
    return 'This deployment attempt was superseded by a newer request.'
  }
  if (processResult === 'dead_letter' || processResult === 'not_found') {
    return 'Deployment activation completed, but its post-activation event could not be retried automatically.'
  }
  if (
    processResult === 'pending' ||
    processResult === 'processing' ||
    processResult === 'lease_lost'
  ) {
    return 'Deployment activation completed, and post-activation notifications are queued.'
  }
  return undefined
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

  const undeployWorkspaceId = workflowData.workspaceId as string | null
  if (undeployWorkspaceId) {
    void emitWorkflowUndeployedEvent({
      workflowId,
      workflowName: (workflowData.name as string) || workflowId,
      workspaceId: undeployWorkspaceId,
    })
  }

  return { success: true, warnings: sideEffectWarning ? [sideEffectWarning] : undefined }
}

export interface PerformActivateVersionParams {
  workflowId: string
  version: number
  userId: string
  requestId?: string
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
}

export interface PerformActivateVersionResult {
  success: boolean
  deployedAt?: Date
  activeDeployment?: ActiveDeploymentResult | null
  latestDeploymentAttempt?: DeploymentAttemptResult | null
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
 * Admits an existing version through the v2 prepare/activate protocol.
 */
export async function performActivateVersion(
  params: PerformActivateVersionParams
): Promise<PerformActivateVersionResult> {
  const { workflowId, version, userId } = params
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

    const status = await getWorkflowDeploymentStatus(workflowId)
    const stableResult = buildStableDeploymentResult(status, 'completed')
    return {
      success: true,
      deployedAt: stableResult.deployedAt ?? workflowDeployment?.deployedAt ?? new Date(),
      activeDeployment: stableResult.activeDeployment,
      latestDeploymentAttempt: stableResult.latestDeploymentAttempt,
      warnings: stableResult.warnings,
    }
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

  try {
    return await performStableVersionActivation({
      workflowId,
      deploymentVersionId: versionRow.id,
      version,
      userId,
      actorId,
      requestId,
    })
  } catch (error) {
    logger.error(`[${requestId}] Version activation preparation failed`, {
      workflowId,
      version,
      error,
    })
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to prepare version activation'),
      errorCode: 'internal',
    }
  }
}

async function performStableVersionActivation(params: {
  workflowId: string
  deploymentVersionId: string
  version: number
  userId: string
  actorId: string
  requestId: string
}): Promise<PerformActivateVersionResult> {
  let outboxEventId: string | undefined
  const prepared = await prepareWorkflowVersionActivation({
    workflowId: params.workflowId,
    deploymentVersionId: params.deploymentVersionId,
    actorId: params.actorId,
    requestHash: createDeploymentRequestHash({
      action: 'activate',
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      version: params.version,
      userId: params.userId,
    }),
    idempotencyKey: params.requestId,
    readinessComponents: DEPLOYMENT_READINESS_COMPONENTS,
    onPrepareTransaction: async (tx, operation) => {
      if (!operation.deploymentVersionId || operation.version === null) {
        throw new Error('Prepared activation operation is missing its target version')
      }
      outboxEventId = await enqueueWorkflowDeploymentPreparation(tx, {
        protocolVersion: operation.protocolVersion,
        operationId: operation.id,
        generation: operation.generation,
        workflowId: operation.workflowId,
        deploymentVersionId: operation.deploymentVersionId,
        version: operation.version,
        userId: params.userId,
        requestId: params.requestId,
        checkpoints: {},
      })
    },
  })

  if (!prepared.success) {
    return {
      success: false,
      error: prepared.error,
      errorCode: mapPrepareFailureCode(prepared.reason),
    }
  }

  const processResult = await processStableDeploymentPreparationNow(outboxEventId, params.requestId)
  const status = await getWorkflowDeploymentStatus(params.workflowId)
  const inlineFailure = buildInlinePreparationFailure(prepared.operation.id, status)
  if (inlineFailure) return inlineFailure
  const result = buildStableDeploymentResult(status, processResult)
  return {
    success: result.success,
    deployedAt: result.deployedAt,
    activeDeployment: result.activeDeployment,
    latestDeploymentAttempt: result.latestDeploymentAttempt,
    warnings: result.warnings,
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
