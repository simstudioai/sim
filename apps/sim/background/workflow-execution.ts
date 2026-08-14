import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task, timeout } from '@trigger.dev/sdk'
import {
  refreshExecutionSlotExpiry,
  releaseExecutionSlot,
} from '@/lib/billing/calculations/usage-reservation'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import {
  capExecutionTimeoutMs,
  createTimeoutAbortController,
  ExecutionTimeoutError,
  getAsyncExecutionTimeoutForBillingAttribution,
  getExecutionDeadlineAt,
  getTimeoutErrorMessage,
  RESERVATION_TTL_BUFFER_MS,
} from '@/lib/core/execution-limits'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { cleanupExecutionBase64Cache } from '@/lib/uploads/utils/user-file-base64.server'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { WORKFLOW_EXECUTION_CONCURRENCY_LIMIT } from '@/background/concurrency-limits'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('TriggerWorkflowExecution')

export function buildWorkflowCorrelation(
  payload: WorkflowExecutionPayload
): AsyncExecutionCorrelation {
  const executionId = payload.executionId || generateId()
  const requestId = payload.requestId || payload.correlation?.requestId || executionId.slice(0, 8)

  return {
    executionId,
    requestId,
    source: 'workflow',
    workflowId: payload.workflowId,
    ...(payload.correlation?.copilotToolCallId
      ? { copilotToolCallId: payload.correlation.copilotToolCallId }
      : {}),
    triggerType: payload.triggerType || payload.correlation?.triggerType || 'api',
  }
}

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  billingAttribution: BillingAttributionSnapshot
  workspaceId: string
  input?: any
  triggerType?: CoreTriggerType
  triggerBlockId?: string
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  metadata?: Record<string, any>
  callChain?: string[]
  executionMode?: 'sync' | 'stream' | 'async'
  /** Upstream preprocessing already consumed rate-limit quota and owns the usage reservation. */
  admissionCompleted?: boolean
  /** Optional trusted cap already resolved by the async API admission boundary. */
  executionTimeoutMs?: number
  /** Authenticated input provenance validated by the workflow execution boundary. */
  trustedInitialResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /**
   * Identity decisions the enqueuing surface already made. They must ride the
   * payload because the worker has no request to re-derive them from, and a
   * queued run that dropped them would resolve its personal variables as the
   * workflow owner while still authorizing workspace variables as the actor.
   */
  enforceCredentialAccess?: boolean
  isPublicApiAccess?: boolean
}

/**
 * Background workflow execution job
 * @see preprocessExecution For detailed information on preprocessing checks
 * @see executeWorkflowCore For the core workflow execution logic
 */
export async function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  externalAbortSignal?: AbortSignal
) {
  const workflowId = payload.workflowId
  const correlation = buildWorkflowCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = assertBillingAttributionSnapshot(payload.billingAttribution)
    if (
      billingAttribution.actorUserId !== payload.userId ||
      billingAttribution.workspaceId !== payload.workspaceId
    ) {
      throw new Error('Workflow job billing attribution does not match its actor and workspace')
    }
  } catch (error) {
    await releaseExecutionSlot(executionId)
    throw error
  }

  const timeoutController = createTimeoutAbortController(
    capExecutionTimeoutMs(
      getAsyncExecutionTimeoutForBillingAttribution(billingAttribution),
      payload.executionTimeoutMs
    ),
    externalAbortSignal
  )

  try {
    const executionDeadlineAt = getExecutionDeadlineAt(timeoutController.signal)?.getTime()
    let admissionCompleted = payload.admissionCompleted === true
    if (admissionCompleted && executionDeadlineAt !== undefined) {
      admissionCompleted = await refreshExecutionSlotExpiry(
        executionId,
        executionDeadlineAt + RESERVATION_TTL_BUFFER_MS
      )
      if (!admissionCompleted) {
        logger.warn('Queued workflow reservation expired; repeating usage admission', {
          workflowId,
          executionId,
        })
      }
    }

    return await runWithRequestContext({ requestId }, async () => {
      logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
        userId: payload.userId,
        triggerType: payload.triggerType,
        executionId,
      })

      const triggerType = (correlation.triggerType || 'api') as CoreTriggerType
      const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)
      if (correlation.copilotToolCallId) {
        loggingSession.setTrustedExecutionCorrelation(correlation)
      }
      loggingSession.setExecutionDeadlineAt(getExecutionDeadlineAt(timeoutController.signal))

      try {
        const preprocessResult = await preprocessExecution({
          workflowId: payload.workflowId,
          userId: payload.userId,
          triggerType: triggerType,
          executionId: executionId,
          requestId: requestId,
          checkRateLimit: !admissionCompleted,
          checkDeployment: true,
          skipUsageLimits: admissionCompleted,
          loggingSession: loggingSession,
          triggerData: { correlation },
          billingAttribution,
          executionType: 'async',
          executionDeadlineAt,
        })

        if (!preprocessResult.success) {
          logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`, {
            workflowId,
            statusCode: preprocessResult.error?.statusCode,
          })

          throw new Error(preprocessResult.error?.message || 'Preprocessing failed')
        }

        const actorUserId = preprocessResult.actorUserId!
        const workspaceId = preprocessResult.workflowRecord?.workspaceId
        if (!workspaceId) {
          throw new Error(`Workflow ${workflowId} has no associated workspace`)
        }

        logger.info(`[${requestId}] Preprocessing passed. Using actor: ${actorUserId}`)

        const workflow = preprocessResult.workflowRecord!

        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId,
          workspaceId,
          userId: actorUserId,
          billingAttribution: preprocessResult.billingAttribution,
          sessionUserId: undefined,
          workflowUserId: workflow.userId,
          triggerType: payload.triggerType || 'api',
          triggerBlockId: payload.triggerBlockId,
          useDraftState: false,
          startTime: new Date().toISOString(),
          isClientSession: false,
          enforceCredentialAccess: payload.enforceCredentialAccess ?? false,
          isPublicApiAccess: payload.isPublicApiAccess ?? false,
          callChain: payload.callChain,
          correlation,
          executionMode: payload.executionMode ?? 'async',
        }

        const snapshot = new ExecutionSnapshot(
          metadata,
          workflow,
          payload.input,
          workflow.variables || {},
          []
        )

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          includeFileBase64: true,
          base64MaxBytes: undefined,
          abortSignal: timeoutController.signal,
          trustedInitialResolvedSecretTraceProvenance:
            payload.trustedInitialResolvedSecretTraceProvenance,
        })

        let timeoutError: ExecutionTimeoutError | undefined
        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          logger.info(`[${requestId}] Workflow execution timed out`, {
            timeoutMs: timeoutController.timeoutMs,
          })
          await loggingSession.markAsFailed(timeoutErrorMessage)
          timeoutError = new ExecutionTimeoutError(timeoutErrorMessage)
        } else {
          await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })
        }

        await loggingSession.waitForPostExecution()

        if (timeoutError) throw timeoutError

        logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
          success: result.success,
          executionTime: result.metadata?.duration,
          executionId,
        })

        return {
          success: result.success,
          workflowId: payload.workflowId,
          executionId,
          output: result.output,
          executedAt: new Date().toISOString(),
          metadata: payload.metadata,
        }
      } catch (error: unknown) {
        logger.error(
          `[${requestId}] Workflow execution failed: ${workflowId}`,
          loggingSession.projectDiagnosticError(error, { executionId })
        )

        if (error instanceof ExecutionTimeoutError) throw error

        if (wasExecutionFinalizedByCore(error, executionId)) {
          throw error
        }

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
        const { traceSpans } = executionResult
          ? buildTraceSpans(executionResult)
          : { traceSpans: [] }

        await loggingSession.safeCompleteWithError({
          error: {
            message: toError(error).message,
            stackTrace: error instanceof Error ? error.stack : undefined,
          },
          traceSpans,
          executionState: executionResult?.executionState,
        })

        throw error
      } finally {
        void cleanupExecutionBase64Cache(executionId)
      }
    })
  } finally {
    timeoutController.cleanup()
  }
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  maxDuration: timeout.None,
  machine: 'medium-2x',
  queue: {
    concurrencyLimit: WORKFLOW_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: (payload: WorkflowExecutionPayload, { signal }) => executeWorkflowJob(payload, signal),
})
