import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { PrincipalActor } from '@sim/auth/principal'
import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  continueOutboxHandler,
  type DeferredOutboxHandlerResult,
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
  cleanupInactiveDeploymentWebhooks,
  cleanupWebhooksForWorkflow,
  prepareStableTriggerWebhooksForDeploy,
  saveTriggerWebhooksForDeploy,
} from '@/lib/webhooks/deploy'
import { cleanupRetiredWebhookRegistrationsAfterActivation } from '@/lib/webhooks/registration-service'
import { activateWebhookRegistrations } from '@/lib/webhooks/registration-store'
import {
  DEPLOYMENT_ERROR_CODES,
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
  getProtectedDeploymentVersionId,
  isDeploymentOperationCurrent,
  isDeploymentVersionActive,
  isDeploymentVersionProtectedByCurrentOperation,
  markDeploymentComponentReadiness,
  markDeploymentOperationFailed,
  recordDeploymentOperationRetry,
  setDeploymentTxTimeouts,
  type WorkflowDeploymentOperation,
} from '@/lib/workflows/persistence/deployment-operations'
import {
  createSchedulesForDeploy,
  deleteInactiveDeploymentSchedules,
  deleteSchedulesForWorkflow,
} from '@/lib/workflows/schedules'
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

/**
 * One inline attempt at deploy time plus three exponential-backoff retries.
 * Checkpoints make retries resumable, so a persistently failing preparation
 * reaches its terminal failed state within roughly half a minute instead of
 * burning a long retry tail while the UI shows retrying.
 */
const DEPLOYMENT_PREPARATION_MAX_ATTEMPTS = 4

/**
 * Webhooks retired per outbox attempt when cleaning up inactive deployment
 * versions. Each costs a provider call, so the batch keeps one attempt well
 * inside the handler timeout; the handler continues through the outbox while
 * rows remain.
 */
const INACTIVE_WEBHOOK_CLEANUP_BATCH_SIZE = 20

const INACTIVE_CLEANUP_CONTINUATION_REASON = 'Continuing inactive deployment side-effect cleanup'

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
  actor?: PrincipalActor
  captureAnalytics?: false
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
  /**
   * Versions the undeploy retired. Cleanup finds stale rows from the versions'
   * current state instead; kept for one release so events written by earlier
   * pods still parse, and events written here still parse on them.
   */
  deploymentVersionIds?: string[]
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
    maxAttempts: DEPLOYMENT_PREPARATION_MAX_ATTEMPTS,
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
        status === 409
          ? DEPLOYMENT_ERROR_CODES.webhookPathConflict
          : DEPLOYMENT_ERROR_CODES.invalidTriggerConfiguration
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
      return await prepareDeploymentOperation(payload, context, prepareWebhooks)
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
        throw error
      }

      try {
        /**
         * Transient failure with retries remaining: surface the live error on
         * the in-flight operation so status consumers show "retrying" instead
         * of a blank pending state. Best-effort — the outbox retry is the
         * durable mechanism, not this record.
         */
        await recordDeploymentOperationRetry({
          workflowId: payload.workflowId,
          operationId: payload.operationId,
          generation: payload.generation,
          error,
        })
      } catch (recordError) {
        logger.warn('Failed to record deployment retry state', {
          workflowId: payload.workflowId,
          operationId: payload.operationId,
          error: toError(recordError).message,
        })
      }
      throw error
    }
  }
}

async function prepareDeploymentOperation(
  payload: PrepareDeploymentV2Payload,
  context: OutboxEventContext,
  prepareWebhooks: PrepareDeploymentWebhooksHook
): Promise<DeferredOutboxHandlerResult | undefined> {
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
    /**
     * Resuming an attempt that already activated. The terminal short circuit
     * above cannot catch this case — a superseded-after-activation attempt
     * keeps its own `active` status — so the generation fence is applied per
     * step inside {@link runPostActivationWork} rather than here: the
     * notifications describe a cutover that really happened and stay owed
     * whatever else has started since, while only the fenced cleanup is
     * skipped.
     */
    return runPostActivationWork({
      payload,
      operation,
      workflow: workflowRecord as Record<string, unknown>,
      checkpoints,
      checkpoint,
      context,
    })
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

  return runPostActivationWork({
    payload,
    operation,
    workflow: workflowRecord as Record<string, unknown>,
    checkpoints,
    checkpoint,
    context,
  })
}

/**
 * Runs everything that follows a committed cutover — notifications first.
 *
 * The ordering is load-bearing. The audit entry, analytics event, socket
 * notification, and workspace event all describe an activation that is
 * already durable, and each is individually checkpointed. Retiring the
 * previous generation's external subscriptions is best-effort cleanup that
 * makes one provider call per retired row and is by far the slowest, most
 * failure-prone step here. Running cleanup first put every one of those
 * notifications behind it, so a single flaky provider — or the handler
 * timeout its latency burns through — silently cost the deploy its audit
 * trail and left clients on the old version until something else refreshed
 * them. Nothing below depends on the cleanup having run.
 *
 * It also decides where the generation fence goes. Both cleanups carry their
 * own, because only they are fenced; the notifications are not, and gating
 * them on the same predicate would drop them for good in the window where a
 * newer generation exists but has not activated — this activation is still
 * the live one there, and nothing else will emit them.
 *
 * Inactive-version cleanup is bounded per attempt. While rows remain, the
 * handler yields a continuation so the outbox re-runs it without spending an
 * attempt; the notifications above are checkpointed and never repeat.
 */
async function runPostActivationWork(params: {
  payload: PrepareDeploymentV2Payload
  operation: WorkflowDeploymentOperation
  workflow: Record<string, unknown>
  checkpoints: DeploymentPreparationCheckpoints
  checkpoint: (patch: Partial<DeploymentPreparationCheckpoints>) => Promise<void>
  context: OutboxEventContext
}): Promise<DeferredOutboxHandlerResult | undefined> {
  await emitPostActivationSideEffects(params)
  await cleanupRetiredWebhooksForOperation({
    payload: params.payload,
    workflow: params.workflow,
    context: params.context,
  })
  const cleanupComplete = await cleanupInactiveDeploymentsForOperation({
    payload: params.payload,
    workflow: params.workflow,
    checkpoints: params.checkpoints,
    checkpoint: params.checkpoint,
    context: params.context,
  })
  return cleanupComplete ? undefined : continueOutboxHandler(INACTIVE_CLEANUP_CONTINUATION_REASON)
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
  const fence = {
    workflowId: params.payload.workflowId,
    operationId: params.payload.operationId,
    generation: params.payload.generation,
    deploymentVersionId: params.payload.deploymentVersionId,
  }

  /**
   * Gated exactly like {@link cleanupInactiveDeploymentsForOperation} below,
   * and on the same predicate the store asserts internally — the store throws
   * where this returns, so a superseded attempt would otherwise fail here
   * identically on every retry until the event dead-lettered. Skipping loses
   * nothing: a newer generation collects every retired row below its own
   * fence, this one included.
   */
  const isCurrent = await isDeploymentOperationCurrent({ ...fence, statuses: ['active'] })
  params.context.signal.throwIfAborted()
  if (!isCurrent) {
    logger.info('Skipping retired webhook cleanup for a superseded generation', {
      workflowId: params.payload.workflowId,
      operationId: params.payload.operationId,
      generation: params.payload.generation,
      errorCode: DEPLOYMENT_ERROR_CODES.operationSuperseded,
    })
    return
  }

  await cleanupRetiredWebhookRegistrationsAfterActivation({
    fence,
    workflow: params.workflow,
    requestId: params.payload.requestId,
    signal: params.context.signal,
  })
}

/**
 * Returns false while inactive-version cleanup still has rows to retire, so
 * the caller yields a continuation instead of completing the event. A
 * superseded attempt returns true: the newer generation owns the cleanup now.
 */
async function cleanupInactiveDeploymentsForOperation(params: {
  payload: PrepareDeploymentV2Payload
  workflow: Record<string, unknown>
  checkpoints: DeploymentPreparationCheckpoints
  checkpoint: (patch: Partial<DeploymentPreparationCheckpoints>) => Promise<void>
  context: OutboxEventContext
}): Promise<boolean> {
  if (params.checkpoints.inactiveCleanupCompleted) return true
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

  if (!(await shouldContinue())) return true
  const { complete } = await cleanupInactiveDeploymentSideEffects({
    workflowId: params.payload.workflowId,
    workflow: params.workflow,
    requestId: params.payload.requestId,
    shouldContinue,
    operationFence,
  })
  if (!(await shouldContinue())) return true
  if (!complete) return false
  await params.checkpoint({ inactiveCleanupCompleted: true })
  return true
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
        ...(params.payload.actor ? { actor: params.payload.actor } : {}),
      },
    })
    params.context.signal.throwIfAborted()
    await params.checkpoint({ auditEmitted: true })
  }

  /**
   * Analytics is fire-and-forget by contract: PostHog being unreachable must
   * never fail an activation that is already durable. Awaiting a flush here
   * bought no delivery the process does not already have — the client flushes
   * on its own interval and again from the `SIGTERM`/`SIGINT` hook in
   * `instrumentation-node.ts` — while holding the socket notification, the
   * workspace event, and subscription cleanup behind a third party, and
   * failing the outbox event until it dead-lettered when that party was down.
   * `flush()` also drains the whole shared client queue, so an unrelated
   * event's network error surfaced here as a failed deploy.
   */
  if (!params.checkpoints.analyticsCaptured) {
    params.context.signal.throwIfAborted()
    if (params.payload.captureAnalytics !== false) {
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
          insertId: params.context.eventId,
          groups: workspaceId ? { workspace: workspaceId } : undefined,
          ...(isVersionActivation
            ? {}
            : { setOnce: { first_workflow_deployed_at: new Date().toISOString() } }),
        }
      )
    }
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

const cleanupInactiveSideEffects: OutboxHandler = async (rawPayload, context) => {
  const payload = parseCleanupInactiveSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  context.signal.throwIfAborted()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return

  const { complete } = await cleanupInactiveDeploymentSideEffects({
    workflowId: payload.workflowId,
    workflow: workflowRecord as Record<string, unknown>,
    requestId,
    shouldContinue: unlessAborted(context.signal),
  })
  if (!complete) return continueOutboxHandler(INACTIVE_CLEANUP_CONTINUATION_REASON)
}

const cleanupUndeployedSideEffects: OutboxHandler = async (rawPayload, context) => {
  const payload = parseCleanupUndeployedSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  context.signal.throwIfAborted()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return
  const workflowData = workflowRecord as Record<string, unknown>

  const { complete } = await cleanupInactiveDeploymentSideEffects({
    workflowId: payload.workflowId,
    workflow: workflowData,
    requestId,
    shouldContinue: unlessAborted(context.signal),
  })
  if (!complete) return continueOutboxHandler(INACTIVE_CLEANUP_CONTINUATION_REASON)

  context.signal.throwIfAborted()
  await cleanupNullVersionWebhooksIfStillUndeployed({
    workflowId: payload.workflowId,
    workflow: workflowData,
    requestId,
    signal: context.signal,
  })

  context.signal.throwIfAborted()
  await removeMcpToolsIfStillUndeployed(payload.workflowId, requestId)
}

/** Continuation gate for handlers without an operation fence: stops only when the lease aborts. */
function unlessAborted(signal: AbortSignal): () => Promise<boolean> {
  return async () => {
    signal.throwIfAborted()
    return true
  }
}

/**
 * Run inactive-version cleanup synchronously as part of the active-version sync, right
 * after the active version's webhooks/schedules are registered.
 *
 * {@link cleanupInactiveDeploymentSideEffects} only selects rows whose version is inactive and
 * re-checks each webhook right before its delete, so it can never touch the now-active version.
 * Running it inline — rather than only enqueueing it — closes the window where a lost
 * `CLEANUP_INACTIVE` outbox event leaves superseded webhooks behind as live-but-never-polled
 * `is_active` orphans. The deferred event is kept as a fallback so cleanup still continues if
 * the inline pass throws or has more rows than one bounded pass retires, without failing the
 * already-succeeded registration.
 */
async function syncInactiveDeploymentCleanup(params: {
  workflowId: string
  activeDeploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
}): Promise<void> {
  try {
    const { complete } = await cleanupInactiveDeploymentSideEffects({
      workflowId: params.workflowId,
      workflow: params.workflow,
      requestId: params.requestId,
    })
    if (complete) return
    logger.info(
      `[${params.requestId}] Inline inactive-deployment cleanup has more rows; continuing through the outbox`
    )
  } catch (cleanupError) {
    logger.warn(
      `[${params.requestId}] Inline inactive-deployment cleanup failed; deferring to outbox retry`,
      cleanupError
    )
  }
  await enqueueWorkflowInactiveDeploymentCleanup(db, {
    workflowId: params.workflowId,
    activeDeploymentVersionId: params.activeDeploymentVersionId,
    userId: params.userId,
    requestId: params.requestId,
  })
}

/**
 * Retires schedules and webhooks still owned by inactive deployment versions
 * of the workflow. Work is keyed by side-effect rows, never by versions, so a
 * workflow deployed hundreds of times costs no more than one deployed twice.
 * Schedules go in one fenced statement; webhooks need a provider call each
 * and drain in bounded batches, with `complete: false` asking the caller to
 * run again. `shouldContinue` gates every step and throws once the outbox
 * lease is aborted.
 */
async function cleanupInactiveDeploymentSideEffects(params: {
  workflowId: string
  workflow: Record<string, unknown>
  requestId: string
  shouldContinue?: () => Promise<boolean>
  operationFence?: DeploymentCleanupOperationFence
}): Promise<{ complete: boolean }> {
  if (params.shouldContinue && !(await params.shouldContinue())) return { complete: false }

  const schedules = await deleteInactiveDeploymentSchedules({
    workflowId: params.workflowId,
    operationFence: params.operationFence,
  })
  if (schedules.status === 'superseded') return { complete: false }

  if (params.shouldContinue && !(await params.shouldContinue())) return { complete: false }
  const protectedDeploymentVersionId = await getProtectedDeploymentVersionId(params.workflowId)
  const { hasMore } = await cleanupInactiveDeploymentWebhooks({
    workflowId: params.workflowId,
    workflow: params.workflow,
    requestId: params.requestId,
    protectedDeploymentVersionId,
    limit: INACTIVE_WEBHOOK_CLEANUP_BATCH_SIZE,
    shouldContinue: params.shouldContinue,
  })
  return { complete: !hasMore }
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
    await setDeploymentTxTimeouts(tx)
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

/**
 * The per-row gate also throws once the outbox lease aborts, so a timed-out
 * undeploy stops between webhooks instead of overlapping its reaped retry.
 */
async function cleanupNullVersionWebhooksIfStillUndeployed(params: {
  workflowId: string
  workflow: Record<string, unknown>
  requestId: string
  signal: AbortSignal
}): Promise<void> {
  const isStillUndeployed = async () => {
    params.signal.throwIfAborted()
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
    await setDeploymentTxTimeouts(tx)
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
    await setDeploymentTxTimeouts(tx)
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
  const actor = parseOptionalPrincipalActor(record.actor)
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
    ...(actor ? { actor } : {}),
    ...(record.captureAnalytics === false ? { captureAnalytics: false as const } : {}),
    requestId,
    checkpoints,
  }
}

function parseOptionalPrincipalActor(value: unknown): PrincipalActor | undefined {
  if (value === undefined) return undefined
  const record = parsePayloadRecord(value)
  const kind = parseRequiredString(record.kind, 'actor.kind')
  if (kind === 'session') {
    return { kind, userId: parseRequiredString(record.userId, 'actor.userId') }
  }
  if (kind === 'personal_api_key') {
    return {
      kind,
      keyId: parseRequiredString(record.keyId, 'actor.keyId'),
      userId: parseRequiredString(record.userId, 'actor.userId'),
    }
  }
  if (kind === 'oauth_access_token') {
    return {
      kind,
      tokenId: parseRequiredString(record.tokenId, 'actor.tokenId'),
      clientId: parseRequiredString(record.clientId, 'actor.clientId'),
      userId: parseRequiredString(record.userId, 'actor.userId'),
    }
  }
  if (kind === 'workspace_api_key') {
    return {
      kind,
      keyId: parseRequiredString(record.keyId, 'actor.keyId'),
      workspaceId: parseRequiredString(record.workspaceId, 'actor.workspaceId'),
    }
  }
  if (kind === 'delegated') {
    const serviceId = parseRequiredString(record.serviceId, 'actor.serviceId')
    if (serviceId !== 'copilot' && serviceId !== 'executor' && serviceId !== 'realtime') {
      throw new Error(`Invalid deployment outbox actor service: ${serviceId}`)
    }
    return {
      kind,
      serviceId,
      subjectUserId: parseRequiredString(record.subjectUserId, 'actor.subjectUserId'),
      delegationId: parseRequiredString(record.delegationId, 'actor.delegationId'),
    }
  }
  throw new Error(`Invalid deployment outbox actor kind: ${kind}`)
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
  const deploymentVersionIds = parseOptionalStringArray(
    record.deploymentVersionIds,
    'deploymentVersionIds'
  )
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined

  return {
    workflowId,
    ...(deploymentVersionIds ? { deploymentVersionIds } : {}),
    userId,
    requestId,
  }
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

function parseOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`Deployment outbox payload has an invalid ${fieldName}`)
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
