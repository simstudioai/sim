import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, ne } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  type ProcessSingleOutboxResult,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl, getSocketServerUrl } from '@/lib/core/utils/urls'
import { setWorkflowMcpTransactionLockTimeout } from '@/lib/mcp/server-locks'
import {
  notifyMcpToolServers,
  removeMcpToolsForWorkflow,
  syncMcpToolsForWorkflow,
} from '@/lib/mcp/workflow-mcp-sync'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  cleanupWebhooksForWorkflow,
  prepareStableTriggerWebhooksForDeploy,
  saveTriggerWebhooksForDeploy,
} from '@/lib/webhooks/deploy'
import { cleanupRetiredWebhookRegistrationsAfterActivation } from '@/lib/webhooks/registration-service'
import { activateWebhookRegistrations } from '@/lib/webhooks/registration-store'
import {
  DEPLOYMENT_OPERATION_PROTOCOL_VERSION,
  type DeploymentOperationStatus,
  isDeploymentReadinessComplete,
  isNonRetryableDeploymentError,
  NonRetryableDeploymentError,
  parseDeploymentReadiness,
} from '@/lib/workflows/deployment-lifecycle'
import {
  activateDeploymentOperation,
  beginDeploymentOperationActivation,
  type DeploymentOperationGeneration,
  getDeploymentOperation,
  isDeploymentOperationCurrent,
  isDeploymentVersionProtectedByCurrentOperation,
  markDeploymentComponentReadiness,
  markDeploymentOperationFailed,
  type WorkflowDeploymentOperation,
} from '@/lib/workflows/persistence/deployment-operations'
import { createSchedulesForDeploy, deleteSchedulesForWorkflow } from '@/lib/workflows/schedules'
import { emitWorkflowDeployedEvent } from '@/lib/workspace-events/emitter'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDeploymentOutbox')

export const WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS = {
  PREPARE_V2: 'workflow.deployment.prepare.v2',
  /** One-release rolling compatibility for events admitted by pre-v2 pods. */
  SYNC_ACTIVE_SIDE_EFFECTS: 'workflow.deployment.sync-active-side-effects',
  /** One-release rolling compatibility for cleanup admitted by pre-v2 pods. */
  CLEANUP_INACTIVE_SIDE_EFFECTS: 'workflow.deployment.cleanup-inactive-side-effects',
  CLEANUP_UNDEPLOYED_SIDE_EFFECTS: 'workflow.deployment.cleanup-undeployed-side-effects',
} as const

export const DEPLOYMENT_READINESS_COMPONENTS = ['webhooks', 'schedules', 'mcp'] as const

interface DeploymentPreparationCheckpoints {
  webhooksPrepared?: boolean
  schedulesPrepared?: boolean
  mcpReadyForActivation?: boolean
  inactiveCleanupCompleted?: boolean
  auditEmitted?: boolean
  analyticsCaptured?: boolean
  socketNotified?: boolean
  workspaceEventEmitted?: boolean
}

interface DeploymentCleanupOperationFence extends DeploymentOperationGeneration {
  deploymentVersionId: string
  statuses: readonly DeploymentOperationStatus[]
}

export interface PrepareDeploymentV2Payload {
  protocolVersion: number
  operationId: string
  generation: number
  workflowId: string
  deploymentVersionId: string
  version: number
  userId: string
  requestId: string
  checkpoints: DeploymentPreparationCheckpoints
}

export interface PrepareDeploymentWebhooksInput {
  request: NextRequest
  workflowId: string
  workflow: Record<string, unknown>
  userId: string
  blocks: Record<string, BlockState>
  requestId: string
  deploymentVersionId: string
  operationId: string
  generation: number
  signal: AbortSignal
}

export type PrepareDeploymentWebhooksHook = (input: PrepareDeploymentWebhooksInput) => Promise<void>

interface SyncActiveSideEffectsPayload {
  workflowId: string
  deploymentVersionId: string
  userId: string
  requestId?: string
  forceRecreateSubscriptions?: boolean
}

interface CleanupUndeployedSideEffectsPayload {
  workflowId: string
  deploymentVersionIds: string[]
  userId: string
  requestId?: string
}

interface CleanupInactiveSideEffectsPayload {
  workflowId: string
  activeDeploymentVersionId: string
  userId: string
  requestId?: string
}

export async function enqueueWorkflowDeploymentPreparation(
  executor: Pick<typeof db, 'insert'>,
  payload: PrepareDeploymentV2Payload
): Promise<string> {
  return enqueueOutboxEvent(executor, WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.PREPARE_V2, payload, {
    maxAttempts: 10,
  })
}

export async function enqueueWorkflowUndeploySideEffects(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupUndeployedSideEffectsPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS,
    payload,
    { maxAttempts: 10 }
  )
}

async function enqueueWorkflowInactiveDeploymentCleanup(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupInactiveSideEffectsPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_INACTIVE_SIDE_EFFECTS,
    payload,
    { maxAttempts: 10 }
  )
}

export async function processWorkflowDeploymentOutboxEvent(
  eventId: string
): Promise<ProcessSingleOutboxResult> {
  return processOutboxEventById(eventId, workflowDeploymentOutboxHandlers)
}

/**
 * Notifies connected clients after deployment compatibility state changes.
 */
export async function notifySocketDeploymentChanged(
  workflowId: string,
  options: { signal?: AbortSignal; throwOnError?: boolean } = {}
): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workflow-deployed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId }),
      signal: options.signal,
    })
    if (!response.ok) {
      const error = new Error(
        `Socket deployment notification failed (${response.status}) for workflow ${workflowId}`
      )
      if (options.throwOnError) throw error
      logger.warn(error.message)
    }
  } catch (error) {
    if (options.throwOnError) throw error
    logger.error('Error sending workflow deployed event to socket server', error)
  }
}

const defaultPrepareDeploymentWebhooks: PrepareDeploymentWebhooksHook = async (input) => {
  input.signal.throwIfAborted()
  const result = await prepareStableTriggerWebhooksForDeploy({
    request: input.request,
    workflowId: input.workflowId,
    workflow: input.workflow,
    userId: input.userId,
    blocks: input.blocks,
    requestId: input.requestId,
    deploymentVersionId: input.deploymentVersionId,
    operationId: input.operationId,
    generation: input.generation,
    signal: input.signal,
  })
  input.signal.throwIfAborted()
  if (!result.success) {
    const message = result.error?.message || 'Failed to prepare trigger configuration'
    const status = result.error?.status ?? 500
    if (status >= 400 && status < 500) {
      throw new NonRetryableDeploymentError(
        message,
        status === 409 ? 'webhook_path_conflict' : 'invalid_trigger_configuration'
      )
    }
    throw new Error(message)
  }
}

function createPrepareDeploymentHandler(
  prepareWebhooks: PrepareDeploymentWebhooksHook
): OutboxHandler {
  return async (rawPayload, context) => {
    const payload = parsePrepareDeploymentV2Payload(rawPayload)
    try {
      await prepareDeploymentOperation(payload, context, prepareWebhooks)
    } catch (error) {
      const isFinalAttempt = context.attempts + 1 >= context.maxAttempts
      if (isNonRetryableDeploymentError(error) || isFinalAttempt) {
        const operation = await getDeploymentOperation(payload)
        if (operation?.status === 'preparing' || operation?.status === 'activating') {
          await markDeploymentOperationFailed({
            workflowId: payload.workflowId,
            operationId: payload.operationId,
            generation: payload.generation,
            error,
            errorCode: isNonRetryableDeploymentError(error)
              ? error.errorCode
              : 'preparation_failed',
          })
        }
        if (isNonRetryableDeploymentError(error)) {
          logger.warn('Deployment preparation failed permanently; not retrying', {
            workflowId: payload.workflowId,
            operationId: payload.operationId,
            error: error.message,
          })
          return
        }
      }
      throw error
    }
  }
}

async function prepareDeploymentOperation(
  payload: PrepareDeploymentV2Payload,
  context: OutboxEventContext,
  prepareWebhooks: PrepareDeploymentWebhooksHook
): Promise<void> {
  context.signal.throwIfAborted()
  let operation = await getDeploymentOperation(payload)
  context.signal.throwIfAborted()
  if (!operation || isTerminalNonActiveOperation(operation)) return
  assertPreparationPayloadMatchesOperation(payload, operation)

  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)
  context.signal.throwIfAborted()
  if (!workflowRecord) throw new Error('Workflow missing during deployment preparation')

  const checkpoints = { ...payload.checkpoints }
  const checkpoint = async (patch: Partial<DeploymentPreparationCheckpoints>) => {
    Object.assign(checkpoints, patch)
    context.signal.throwIfAborted()
    await context.checkpointPayload({ checkpoints })
    context.signal.throwIfAborted()
  }

  if (operation.status === 'active') {
    await cleanupRetiredWebhooksForOperation({
      payload,
      workflow: workflowRecord as Record<string, unknown>,
      context,
    })
    await cleanupInactiveDeploymentsForOperation({
      payload,
      workflow: workflowRecord as Record<string, unknown>,
      checkpoints,
      checkpoint,
      context,
    })
    await emitPostActivationSideEffects({
      payload,
      operation,
      workflow: workflowRecord as Record<string, unknown>,
      checkpoints,
      checkpoint,
      context,
    })
    return
  }
  if (operation.status !== 'preparing' && operation.status !== 'activating') return

  const [versionRow] = await db
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, payload.workflowId),
        eq(workflowDeploymentVersion.id, payload.deploymentVersionId)
      )
    )
    .limit(1)
  context.signal.throwIfAborted()
  if (!versionRow?.state) throw new Error('Deployment version missing during preparation')

  const state = versionRow.state as { blocks?: Record<string, BlockState> }
  const blocks = state.blocks
  if (!blocks || typeof blocks !== 'object') {
    throw new Error('Invalid deployed state structure')
  }

  operation = await prepareReadinessComponent({
    payload,
    operation,
    component: 'webhooks',
    checkpointKey: 'webhooksPrepared',
    checkpoints,
    checkpoint,
    context,
    prepare: async () => {
      await prepareWebhooks({
        request: new NextRequest(new URL('/api/webhooks', getBaseUrl())),
        workflowId: payload.workflowId,
        workflow: workflowRecord as Record<string, unknown>,
        userId: payload.userId,
        blocks,
        requestId: payload.requestId,
        deploymentVersionId: payload.deploymentVersionId,
        operationId: payload.operationId,
        generation: payload.generation,
        signal: context.signal,
      })
    },
  })
  if (!operation) return

  operation = await prepareReadinessComponent({
    payload,
    operation,
    component: 'schedules',
    checkpointKey: 'schedulesPrepared',
    checkpoints,
    checkpoint,
    context,
    prepare: async () => {
      const result = await createSchedulesForDeploy(
        payload.workflowId,
        blocks,
        undefined,
        payload.deploymentVersionId,
        payload.operationId
      )
      if (!result.success) {
        throw new Error(result.error || 'Failed to prepare schedules')
      }
    },
  })
  if (!operation) return

  operation = await prepareReadinessComponent({
    payload,
    operation,
    component: 'mcp',
    checkpointKey: 'mcpReadyForActivation',
    checkpoints,
    checkpoint,
    context,
    prepare: async () => {},
  })
  if (!operation) return

  const readiness = parseDeploymentReadiness(operation.componentReadiness)
  if (!readiness || !isDeploymentReadinessComplete(readiness)) return

  if (operation.status === 'preparing') {
    context.signal.throwIfAborted()
    const activating = await beginDeploymentOperationActivation(payload)
    context.signal.throwIfAborted()
    if (!activating.success) {
      if (activating.reason === 'stale_generation' || activating.reason === 'invalid_transition') {
        return
      }
      throw new Error(activating.error)
    }
    operation = activating.operation
  }
  if (operation.status !== 'activating') return

  let affectedMcpServers: Array<{ serverId: string }> = []
  context.signal.throwIfAborted()
  const activated = await activateDeploymentOperation({
    workflowId: payload.workflowId,
    operationId: payload.operationId,
    generation: payload.generation,
    onActivateTransaction: async (tx) => {
      context.signal.throwIfAborted()
      await activateWebhookRegistrations(tx, {
        workflowId: payload.workflowId,
        operationId: payload.operationId,
        generation: payload.generation,
        deploymentVersionId: payload.deploymentVersionId,
      })
      context.signal.throwIfAborted()
      await setWorkflowMcpTransactionLockTimeout(tx)
      context.signal.throwIfAborted()
      affectedMcpServers = await syncMcpToolsForWorkflow({
        workflowId: payload.workflowId,
        requestId: payload.requestId,
        state,
        context: 'deployment-activation',
        tx,
        notify: false,
        throwOnError: true,
      })
      context.signal.throwIfAborted()
    },
  })
  context.signal.throwIfAborted()
  if (!activated.success) {
    if (activated.reason === 'stale_generation' || activated.reason === 'invalid_transition') return
    throw new Error(activated.error)
  }

  operation = activated.operation
  notifyMcpToolServers(affectedMcpServers)
  context.signal.throwIfAborted()

  await cleanupRetiredWebhooksForOperation({
    payload,
    workflow: workflowRecord as Record<string, unknown>,
    context,
  })
  await cleanupInactiveDeploymentsForOperation({
    payload,
    workflow: workflowRecord as Record<string, unknown>,
    checkpoints,
    checkpoint,
    context,
  })
  await emitPostActivationSideEffects({
    payload,
    operation,
    workflow: workflowRecord as Record<string, unknown>,
    checkpoints,
    checkpoint,
    context,
  })
}

async function prepareReadinessComponent(params: {
  payload: PrepareDeploymentV2Payload
  operation: WorkflowDeploymentOperation
  component: (typeof DEPLOYMENT_READINESS_COMPONENTS)[number]
  checkpointKey: keyof DeploymentPreparationCheckpoints
  checkpoints: DeploymentPreparationCheckpoints
  checkpoint: (patch: Partial<DeploymentPreparationCheckpoints>) => Promise<void>
  context: OutboxEventContext
  prepare: () => Promise<void>
}): Promise<WorkflowDeploymentOperation | null> {
  const readiness = parseDeploymentReadiness(params.operation.componentReadiness)
  if (readiness?.[params.component]?.status === 'ready') {
    if (!params.checkpoints[params.checkpointKey]) {
      await params.checkpoint({ [params.checkpointKey]: true })
    }
    return params.operation
  }

  if (!params.checkpoints[params.checkpointKey]) {
    params.context.signal.throwIfAborted()
    await params.prepare()
    params.context.signal.throwIfAborted()
    await params.checkpoint({ [params.checkpointKey]: true })
  }

  params.context.signal.throwIfAborted()
  const result = await markDeploymentComponentReadiness({
    workflowId: params.payload.workflowId,
    operationId: params.payload.operationId,
    generation: params.payload.generation,
    component: params.component,
    status: 'ready',
    expectedStatus: 'pending',
  })
  params.context.signal.throwIfAborted()
  if (result.success) return result.operation
  if (result.reason === 'stale_generation' || result.reason === 'invalid_transition') return null
  throw new Error(result.error)
}

async function cleanupRetiredWebhooksForOperation(params: {
  payload: PrepareDeploymentV2Payload
  workflow: Record<string, unknown>
  context: OutboxEventContext
}): Promise<void> {
  params.context.signal.throwIfAborted()
  await cleanupRetiredWebhookRegistrationsAfterActivation({
    fence: {
      workflowId: params.payload.workflowId,
      operationId: params.payload.operationId,
      generation: params.payload.generation,
      deploymentVersionId: params.payload.deploymentVersionId,
    },
    workflow: params.workflow,
    requestId: params.payload.requestId,
    signal: params.context.signal,
  })
}

async function cleanupInactiveDeploymentsForOperation(params: {
  payload: PrepareDeploymentV2Payload
  workflow: Record<string, unknown>
  checkpoints: DeploymentPreparationCheckpoints
  checkpoint: (patch: Partial<DeploymentPreparationCheckpoints>) => Promise<void>
  context: OutboxEventContext
}): Promise<void> {
  if (params.checkpoints.inactiveCleanupCompleted) return
  const operationFence = {
    workflowId: params.payload.workflowId,
    operationId: params.payload.operationId,
    generation: params.payload.generation,
    deploymentVersionId: params.payload.deploymentVersionId,
    statuses: ['active'] as const,
  }
  const shouldContinue = async () => {
    params.context.signal.throwIfAborted()
    const isCurrent = await isDeploymentOperationCurrent(operationFence)
    params.context.signal.throwIfAborted()
    return isCurrent
  }

  if (!(await shouldContinue())) return
  await cleanupInactiveDeploymentVersions({
    workflowId: params.payload.workflowId,
    activeDeploymentVersionId: params.payload.deploymentVersionId,
    workflow: params.workflow,
    userId: params.payload.userId,
    requestId: params.payload.requestId,
    shouldContinue,
    operationFence,
  })
  if (!(await shouldContinue())) return
  await params.checkpoint({ inactiveCleanupCompleted: true })
}

async function emitPostActivationSideEffects(params: {
  payload: PrepareDeploymentV2Payload
  operation: WorkflowDeploymentOperation
  workflow: Record<string, unknown>
  checkpoints: DeploymentPreparationCheckpoints
  checkpoint: (patch: Partial<DeploymentPreparationCheckpoints>) => Promise<void>
  context: OutboxEventContext
}): Promise<void> {
  if (!params.checkpoints.auditEmitted) {
    params.context.signal.throwIfAborted()
    const isVersionActivation = params.operation.action === 'activate'
    recordAudit({
      workspaceId: (params.workflow.workspaceId as string) || null,
      actorId: params.operation.actorId,
      action: isVersionActivation
        ? AuditAction.WORKFLOW_DEPLOYMENT_ACTIVATED
        : AuditAction.WORKFLOW_DEPLOYED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: params.payload.workflowId,
      resourceName: (params.workflow.name as string) || undefined,
      description: isVersionActivation
        ? `Activated deployment version ${params.payload.version}`
        : `Deployed workflow "${(params.workflow.name as string) || params.payload.workflowId}"`,
      metadata: {
        deploymentVersionId: params.payload.deploymentVersionId,
        version: params.payload.version,
        previousVersionId: params.operation.previousActiveVersionId || undefined,
      },
    })
    params.context.signal.throwIfAborted()
    await params.checkpoint({ auditEmitted: true })
  }

  if (!params.checkpoints.analyticsCaptured) {
    params.context.signal.throwIfAborted()
    const workspaceId = (params.workflow.workspaceId as string) || ''
    const isVersionActivation = params.operation.action === 'activate'
    captureServerEvent(
      params.payload.userId,
      isVersionActivation ? 'deployment_version_activated' : 'workflow_deployed',
      {
        workflow_id: params.payload.workflowId,
        workspace_id: workspaceId,
        ...(isVersionActivation ? { version: params.payload.version } : {}),
      },
      {
        groups: workspaceId ? { workspace: workspaceId } : undefined,
        ...(isVersionActivation
          ? {}
          : { setOnce: { first_workflow_deployed_at: new Date().toISOString() } }),
      }
    )
    await params.checkpoint({ analyticsCaptured: true })
  }

  if (!params.checkpoints.socketNotified) {
    params.context.signal.throwIfAborted()
    await notifySocketDeploymentChanged(params.payload.workflowId, {
      signal: params.context.signal,
      throwOnError: true,
    })
    params.context.signal.throwIfAborted()
    await params.checkpoint({ socketNotified: true })
  }

  const workspaceId = params.workflow.workspaceId as string | null
  if (workspaceId && !params.checkpoints.workspaceEventEmitted) {
    params.context.signal.throwIfAborted()
    await emitWorkflowDeployedEvent({
      workflowId: params.payload.workflowId,
      workflowName: (params.workflow.name as string) || params.payload.workflowId,
      workspaceId,
      version: params.payload.version,
    })
    params.context.signal.throwIfAborted()
    await params.checkpoint({ workspaceEventEmitted: true })
  }
}

function isTerminalNonActiveOperation(operation: WorkflowDeploymentOperation): boolean {
  return operation.status === 'failed' || operation.status === 'superseded'
}

function assertPreparationPayloadMatchesOperation(
  payload: PrepareDeploymentV2Payload,
  operation: WorkflowDeploymentOperation
): void {
  if (
    payload.protocolVersion !== DEPLOYMENT_OPERATION_PROTOCOL_VERSION ||
    operation.protocolVersion !== payload.protocolVersion
  ) {
    throw new Error(`Unsupported deployment preparation protocol ${payload.protocolVersion}`)
  }
  if (
    operation.deploymentVersionId !== payload.deploymentVersionId ||
    operation.version !== payload.version
  ) {
    throw new Error('Deployment preparation payload does not match its operation')
  }
}

const syncActiveSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseSyncActiveSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) {
    logger.warn(`[${requestId}] Workflow missing during deployment side-effect sync`, {
      workflowId: payload.workflowId,
    })
    return
  }

  const [versionRow] = await db
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
      isActive: workflowDeploymentVersion.isActive,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, payload.workflowId),
        eq(workflowDeploymentVersion.id, payload.deploymentVersionId)
      )
    )
    .limit(1)

  if (!versionRow?.isActive) {
    logger.info(`[${requestId}] Skipping stale deployment side-effect sync`, {
      workflowId: payload.workflowId,
      deploymentVersionId: payload.deploymentVersionId,
    })
    if (versionRow) {
      await cleanupDeploymentVersionIfInactive({
        workflowId: payload.workflowId,
        deploymentVersionId: payload.deploymentVersionId,
        workflow: workflowRecord as Record<string, unknown>,
        userId: payload.userId,
        requestId,
      })
    }
    return
  }

  const state = versionRow.state as { blocks?: Record<string, BlockState> }
  const blocks = state.blocks ?? {}
  const workflowData = workflowRecord as Record<string, unknown>

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  const request = new NextRequest(new URL('/api/webhooks', getBaseUrl()))
  const triggerSaveResult = await saveTriggerWebhooksForDeploy({
    request,
    workflowId: payload.workflowId,
    workflow: workflowData,
    userId: payload.userId,
    blocks,
    requestId,
    deploymentVersionId: payload.deploymentVersionId,
    forceRecreateSubscriptions: payload.forceRecreateSubscriptions ?? false,
    strictExternalCleanup: true,
  })

  if (!triggerSaveResult.success) {
    throw new Error(triggerSaveResult.error?.message || 'Failed to sync trigger configuration')
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  const scheduleResult = await createSchedulesIfStillActive({
    workflowId: payload.workflowId,
    deploymentVersionId: payload.deploymentVersionId,
    blocks,
  })
  if (!scheduleResult.success) {
    throw new Error(scheduleResult.error || 'Failed to sync schedules')
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  await syncMcpToolsIfStillActive({
    workflowId: payload.workflowId,
    deploymentVersionId: payload.deploymentVersionId,
    requestId,
    state,
  })

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  if (workflowRecord.workspaceId) {
    await pruneWorkflowGroupOutputsIfStillActive({
      workflowId: payload.workflowId,
      deploymentVersionId: payload.deploymentVersionId,
      workspaceId: workflowRecord.workspaceId,
      validBlockIds: new Set(Object.keys(blocks)),
      requestId,
    })
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  await syncInactiveDeploymentCleanup({
    workflowId: payload.workflowId,
    activeDeploymentVersionId: payload.deploymentVersionId,
    workflow: workflowData,
    userId: payload.userId,
    requestId,
  })
}

const cleanupInactiveSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseCleanupInactiveSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return

  await cleanupInactiveDeploymentVersions({
    workflowId: payload.workflowId,
    activeDeploymentVersionId: payload.activeDeploymentVersionId,
    workflow: workflowRecord as Record<string, unknown>,
    userId: payload.userId,
    requestId,
  })
}

const cleanupUndeployedSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseCleanupUndeployedSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return
  const workflowData = workflowRecord as Record<string, unknown>

  for (const deploymentVersionId of payload.deploymentVersionIds) {
    const [versionRow] = await db
      .select({ isActive: workflowDeploymentVersion.isActive })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, payload.workflowId),
          eq(workflowDeploymentVersion.id, deploymentVersionId)
        )
      )
      .limit(1)

    if (!versionRow || versionRow.isActive) continue
    await cleanupDeploymentVersionIfInactive({
      workflowId: payload.workflowId,
      workflow: workflowData,
      userId: payload.userId,
      requestId,
      deploymentVersionId,
    })
  }

  await cleanupNullVersionWebhooksIfStillUndeployed({
    workflowId: payload.workflowId,
    workflow: workflowData,
    requestId,
  })

  await removeMcpToolsIfStillUndeployed(payload.workflowId, requestId)
}

/**
 * Run inactive-version cleanup synchronously as part of the active-version sync, right
 * after the active version's webhooks/schedules are registered.
 *
 * {@link cleanupInactiveDeploymentVersions} re-checks that each version is still inactive
 * before tearing anything down, so it can never touch the now-active version. Running it
 * inline — rather than only enqueueing it — closes the window where a lost
 * `CLEANUP_INACTIVE` outbox event leaves superseded webhooks behind as live-but-never-polled
 * `is_active` orphans. The deferred event is kept as a fallback so cleanup still retries if
 * the inline pass throws, without failing the already-succeeded registration.
 */
async function syncInactiveDeploymentCleanup(params: {
  workflowId: string
  activeDeploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
}): Promise<void> {
  try {
    await cleanupInactiveDeploymentVersions(params)
  } catch (cleanupError) {
    logger.warn(
      `[${params.requestId}] Inline inactive-deployment cleanup failed; deferring to outbox retry`,
      cleanupError
    )
    await enqueueWorkflowInactiveDeploymentCleanup(db, {
      workflowId: params.workflowId,
      activeDeploymentVersionId: params.activeDeploymentVersionId,
      userId: params.userId,
      requestId: params.requestId,
    })
  }
}

async function cleanupInactiveDeploymentVersions(params: {
  workflowId: string
  activeDeploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
  shouldContinue?: () => Promise<boolean>
  operationFence?: DeploymentCleanupOperationFence
}): Promise<void> {
  if (params.shouldContinue && !(await params.shouldContinue())) return
  const inactiveVersions = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, params.workflowId),
        ne(workflowDeploymentVersion.id, params.activeDeploymentVersionId),
        eq(workflowDeploymentVersion.isActive, false)
      )
    )

  for (const version of inactiveVersions) {
    if (params.shouldContinue && !(await params.shouldContinue())) return
    if (await isDeploymentVersionProtectedByCurrentOperation(params.workflowId, version.id)) {
      continue
    }
    await cleanupDeploymentVersionIfInactive({
      workflowId: params.workflowId,
      workflow: params.workflow,
      userId: params.userId,
      requestId: params.requestId,
      deploymentVersionId: version.id,
      shouldContinue: params.shouldContinue,
      operationFence: params.operationFence,
    })
  }
}

async function cleanupDeploymentVersionIfInactive(params: {
  workflowId: string
  deploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
  shouldContinue?: () => Promise<boolean>
  operationFence?: DeploymentCleanupOperationFence
}): Promise<void> {
  if (params.shouldContinue && !(await params.shouldContinue())) return
  if (
    await isDeploymentVersionProtectedByCurrentOperation(
      params.workflowId,
      params.deploymentVersionId
    )
  ) {
    return
  }
  if (await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId)) return

  const isStillInactive = async () => {
    if (params.shouldContinue && !(await params.shouldContinue())) return false
    if (
      await isDeploymentVersionProtectedByCurrentOperation(
        params.workflowId,
        params.deploymentVersionId
      )
    ) {
      return false
    }
    return !(await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId))
  }

  await cleanupWebhooksForWorkflow(
    params.workflowId,
    params.workflow,
    params.requestId,
    params.deploymentVersionId,
    false,
    true,
    isStillInactive
  )

  if (!(await isStillInactive())) return

  await deleteSchedulesForDeploymentIfInactive({
    workflowId: params.workflowId,
    deploymentVersionId: params.deploymentVersionId,
    operationFence: params.operationFence,
  })
}

async function deleteSchedulesForDeploymentIfInactive(params: {
  workflowId: string
  deploymentVersionId: string
  operationFence?: DeploymentCleanupOperationFence
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .for('update')
    if (params.operationFence && !(await isDeploymentOperationCurrent(params.operationFence, tx))) {
      return false
    }
    if (
      await isDeploymentVersionProtectedByCurrentOperation(
        params.workflowId,
        params.deploymentVersionId,
        tx
      )
    ) {
      return false
    }

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, false)
        )
      )
      .limit(1)
      .for('update')

    if (!versionRow) return false

    await deleteSchedulesForWorkflow(params.workflowId, tx, params.deploymentVersionId)
    return true
  })
}

async function cleanupStaleDeploymentIfNeeded(params: {
  payload: SyncActiveSideEffectsPayload
  workflow: Record<string, unknown>
  requestId: string
}): Promise<boolean> {
  if (
    await isDeploymentVersionActive(params.payload.workflowId, params.payload.deploymentVersionId)
  ) {
    return true
  }

  logger.info(`[${params.requestId}] Cleaning up stale deployment side effects`, {
    workflowId: params.payload.workflowId,
    deploymentVersionId: params.payload.deploymentVersionId,
  })
  await cleanupDeploymentVersionIfInactive({
    workflowId: params.payload.workflowId,
    workflow: params.workflow,
    userId: params.payload.userId,
    requestId: params.requestId,
    deploymentVersionId: params.payload.deploymentVersionId,
  })
  return false
}

async function isDeploymentVersionActive(
  workflowId: string,
  deploymentVersionId: string
): Promise<boolean> {
  const [versionRow] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.id, deploymentVersionId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)

  return Boolean(versionRow)
}

async function removeMcpToolsIfStillUndeployed(
  workflowId: string,
  requestId: string
): Promise<void> {
  const tools = await db.transaction(async (tx) => {
    await setWorkflowMcpTransactionLockTimeout(tx)

    const [workflowRecord] = await tx
      .select({ id: workflowTable.id, isDeployed: workflowTable.isDeployed })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .for('update')
      .limit(1)

    if (!workflowRecord || workflowRecord.isDeployed) return []
    return removeMcpToolsForWorkflow(workflowId, requestId, tx, true)
  })
  notifyMcpToolServers(tools)
}

async function cleanupNullVersionWebhooksIfStillUndeployed(params: {
  workflowId: string
  workflow: Record<string, unknown>
  requestId: string
}): Promise<void> {
  const isStillUndeployed = async () => {
    const [workflowRecord] = await db
      .select({ isDeployed: workflowTable.isDeployed })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)

    return Boolean(workflowRecord && !workflowRecord.isDeployed)
  }

  if (!(await isStillUndeployed())) return
  await cleanupWebhooksForWorkflow(
    params.workflowId,
    params.workflow,
    params.requestId,
    null,
    false,
    true,
    isStillUndeployed
  )
}

async function syncMcpToolsIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  requestId: string
  state: { blocks?: Record<string, unknown> }
}): Promise<void> {
  const tools = await db.transaction(async (tx) => {
    await setWorkflowMcpTransactionLockTimeout(tx)

    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .for('update')
      .limit(1)

    if (!workflowRecord) return []

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) return []

    return syncMcpToolsForWorkflow({
      workflowId: params.workflowId,
      requestId: params.requestId,
      state: params.state,
      context: 'deployment-outbox',
      tx,
      notify: false,
      throwOnError: true,
    })
  })
  notifyMcpToolServers(tools)
}

async function createSchedulesIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  blocks: Record<string, BlockState>
}) {
  return db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord) {
      return { success: true as const }
    }

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) {
      return { success: true as const }
    }

    const result = await createSchedulesForDeploy(
      params.workflowId,
      params.blocks,
      tx,
      params.deploymentVersionId
    )
    if (!result.success) {
      throw new Error(result.error || 'Failed to sync schedules')
    }
    return result
  })
}

async function pruneWorkflowGroupOutputsIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  workspaceId: string
  validBlockIds: Set<string>
  requestId: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord) return

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) return

    const { pruneStaleWorkflowGroupOutputs } = await import('@/lib/table/workflow-groups/service')
    await pruneStaleWorkflowGroupOutputs({
      workflowId: params.workflowId,
      workspaceId: params.workspaceId,
      validBlockIds: params.validBlockIds,
      requestId: params.requestId,
      tx,
    })
  })
}

function parseSyncActiveSideEffectsPayload(payload: unknown): SyncActiveSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const deploymentVersionId = parseRequiredString(record.deploymentVersionId, 'deploymentVersionId')
  const userId = parseRequiredString(record.userId, 'userId')
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined
  const forceRecreateSubscriptions =
    typeof record.forceRecreateSubscriptions === 'boolean'
      ? record.forceRecreateSubscriptions
      : undefined

  return { workflowId, deploymentVersionId, userId, requestId, forceRecreateSubscriptions }
}

function parsePrepareDeploymentV2Payload(payload: unknown): PrepareDeploymentV2Payload {
  const record = parsePayloadRecord(payload)
  const protocolVersion = parseRequiredPositiveInteger(record.protocolVersion, 'protocolVersion')
  const operationId = parseRequiredString(record.operationId, 'operationId')
  const generation = parseRequiredPositiveInteger(record.generation, 'generation')
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const deploymentVersionId = parseRequiredString(record.deploymentVersionId, 'deploymentVersionId')
  const version = parseRequiredPositiveInteger(record.version, 'version')
  const userId = parseRequiredString(record.userId, 'userId')
  const requestId = parseRequiredString(record.requestId, 'requestId')
  const checkpoints = parseDeploymentPreparationCheckpoints(record.checkpoints)

  return {
    protocolVersion,
    operationId,
    generation,
    workflowId,
    deploymentVersionId,
    version,
    userId,
    requestId,
    checkpoints,
  }
}

function parseDeploymentPreparationCheckpoints(value: unknown): DeploymentPreparationCheckpoints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    ...(record.webhooksPrepared === true ? { webhooksPrepared: true } : {}),
    ...(record.schedulesPrepared === true ? { schedulesPrepared: true } : {}),
    ...(record.mcpReadyForActivation === true ? { mcpReadyForActivation: true } : {}),
    ...(record.inactiveCleanupCompleted === true ? { inactiveCleanupCompleted: true } : {}),
    ...(record.auditEmitted === true ? { auditEmitted: true } : {}),
    ...(record.analyticsCaptured === true ? { analyticsCaptured: true } : {}),
    ...(record.socketNotified === true ? { socketNotified: true } : {}),
    ...(record.workspaceEventEmitted === true ? { workspaceEventEmitted: true } : {}),
  }
}

function parseCleanupUndeployedSideEffectsPayload(
  payload: unknown
): CleanupUndeployedSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const userId = parseRequiredString(record.userId, 'userId')
  const deploymentVersionIds = parseRequiredStringArray(
    record.deploymentVersionIds,
    'deploymentVersionIds'
  )
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined

  return { workflowId, deploymentVersionIds, userId, requestId }
}

function parseCleanupInactiveSideEffectsPayload(
  payload: unknown
): CleanupInactiveSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const activeDeploymentVersionId = parseRequiredString(
    record.activeDeploymentVersionId,
    'activeDeploymentVersionId'
  )
  const userId = parseRequiredString(record.userId, 'userId')
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined

  return { workflowId, activeDeploymentVersionId, userId, requestId }
}

function parsePayloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Deployment outbox payload must be an object')
  }
  return payload as Record<string, unknown>
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Deployment outbox payload is missing ${fieldName}`)
  }
  return value
}

function parseRequiredPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Deployment outbox payload is missing ${fieldName}`)
  }
  return value
}

function parseRequiredStringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`Deployment outbox payload is missing ${fieldName}`)
  }
  return value
}

export function createWorkflowDeploymentOutboxHandlers(
  options: { prepareWebhooks?: PrepareDeploymentWebhooksHook } = {}
): OutboxHandlerRegistry {
  return {
    [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.PREPARE_V2]: createPrepareDeploymentHandler(
      options.prepareWebhooks ?? defaultPrepareDeploymentWebhooks
    ),
    [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.SYNC_ACTIVE_SIDE_EFFECTS]: syncActiveSideEffects,
    [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_INACTIVE_SIDE_EFFECTS]: cleanupInactiveSideEffects,
    [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS]:
      cleanupUndeployedSideEffects,
  }
}

export const workflowDeploymentOutboxHandlers = createWorkflowDeploymentOutboxHandlers()
