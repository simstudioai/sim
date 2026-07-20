import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task } from '@trigger.dev/sdk'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
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
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionAdmissionErrorCode =
  | 'invalid_execution_request'
  | 'invalid_billing_attribution'
  | 'preprocessing_failed'
  | 'workspace_mismatch'
  | 'snapshot_load_failed'

export class WorkflowExecutionAdmissionError extends Error {
  constructor(
    readonly code: WorkflowExecutionAdmissionErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'WorkflowExecutionAdmissionError'
  }
}

export function buildWorkflowCorrelation(
  payload: WorkflowExecutionPayload
): AsyncExecutionCorrelation {
  const executionId = payload.executionId || generateId()
  const requestId = payload.requestId || payload.correlation?.requestId || executionId.slice(0, 8)

  return {
    ...payload.correlation,
    executionId,
    requestId,
    source: payload.correlation?.source ?? 'workflow',
    workflowId: payload.workflowId,
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
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  metadata?: Record<string, any>
  callChain?: string[]
  /** Internal explicit Start block selection for pinned or nested execution paths. */
  triggerBlockId?: string
  executionMode?: 'sync' | 'stream' | 'async'
  /** Execute the persisted draft instead of requiring and loading the deployed version. */
  useDraftState?: boolean
  /** Internal immutable workflow-state reference. Never accepted from a public API request. */
  workflowStateSnapshotId?: string
  /** Eval-only subject block outputs. Never accepted from a public execution API. */
  blockMocks?: ReadonlyArray<{ blockId: string; output: unknown }>
  /** Upstream preprocessing already consumed rate-limit quota and owns the usage reservation. */
  admissionCompleted?: boolean
}

/**
 * Background workflow execution job
 * @see preprocessExecution For detailed information on preprocessing checks
 * @see executeWorkflowCore For the core workflow execution logic
 */
export async function executeWorkflowJob(
  payload: WorkflowExecutionPayload,
  executionContext?: AbortSignal | { signal: AbortSignal }
) {
  const abortSignal = executionContext
    ? 'signal' in executionContext
      ? executionContext.signal
      : executionContext
    : undefined
  const workflowId = payload.workflowId
  const correlation = buildWorkflowCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  let billingAttribution: BillingAttributionSnapshot
  try {
    abortSignal?.throwIfAborted()
    if (payload.triggerBlockId !== undefined && payload.triggerBlockId.trim().length === 0) {
      throw new WorkflowExecutionAdmissionError(
        'invalid_execution_request',
        'Trigger block ID must be a non-empty string'
      )
    }
    if (payload.workflowStateSnapshotId !== undefined) {
      if (payload.workflowStateSnapshotId.trim().length === 0) {
        throw new WorkflowExecutionAdmissionError(
          'invalid_execution_request',
          'Workflow state snapshot ID must be a non-empty string'
        )
      }
      if (payload.useDraftState === false) {
        throw new WorkflowExecutionAdmissionError(
          'invalid_execution_request',
          'Pinned workflow state cannot be combined with useDraftState=false'
        )
      }
    }

    try {
      billingAttribution = assertBillingAttributionSnapshot(payload.billingAttribution)
    } catch (error) {
      throw new WorkflowExecutionAdmissionError(
        'invalid_billing_attribution',
        `Workflow job has invalid billing attribution: ${toError(error).message}`,
        { cause: error }
      )
    }
    if (
      billingAttribution.actorUserId !== payload.userId ||
      billingAttribution.workspaceId !== payload.workspaceId
    ) {
      throw new WorkflowExecutionAdmissionError(
        'invalid_billing_attribution',
        'Workflow job billing attribution does not match its actor and workspace'
      )
    }
  } catch (error) {
    await releaseExecutionSlot(executionId)
    throw error
  }

  return runWithRequestContext({ requestId }, async () => {
    logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
      userId: payload.userId,
      triggerType: payload.triggerType,
      executionId,
    })

    const triggerType = (correlation.triggerType || 'api') as CoreTriggerType
    const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

    try {
      let preprocessResult: Awaited<ReturnType<typeof preprocessExecution>>
      try {
        preprocessResult = await preprocessExecution({
          workflowId: payload.workflowId,
          userId: payload.userId,
          triggerType: triggerType,
          executionId: executionId,
          requestId: requestId,
          checkRateLimit: payload.admissionCompleted !== true,
          checkDeployment:
            payload.useDraftState !== true && payload.workflowStateSnapshotId === undefined,
          skipUsageLimits: payload.admissionCompleted === true,
          loggingSession: loggingSession,
          triggerData: { correlation },
          billingAttribution,
        })
      } catch (error) {
        throw new WorkflowExecutionAdmissionError(
          'preprocessing_failed',
          `Workflow preprocessing failed: ${toError(error).message}`,
          { cause: error }
        )
      }

      if (!preprocessResult.success) {
        logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`, {
          workflowId,
          statusCode: preprocessResult.error?.statusCode,
        })

        throw new WorkflowExecutionAdmissionError(
          'preprocessing_failed',
          preprocessResult.error?.message || 'Preprocessing failed'
        )
      }

      const actorUserId = preprocessResult.actorUserId!
      const workspaceId = preprocessResult.workflowRecord?.workspaceId
      if (!workspaceId) {
        throw new WorkflowExecutionAdmissionError(
          'workspace_mismatch',
          `Workflow ${workflowId} has no associated workspace`
        )
      }
      if (workspaceId !== payload.workspaceId) {
        throw new WorkflowExecutionAdmissionError(
          'workspace_mismatch',
          `Workflow ${workflowId} belongs to workspace ${workspaceId}, expected ${payload.workspaceId}`
        )
      }

      logger.info(`[${requestId}] Preprocessing passed. Using actor: ${actorUserId}`)

      const workflow = preprocessResult.workflowRecord!
      let pinnedSnapshot: Awaited<
        ReturnType<typeof snapshotService.getBoundedSnapshotForWorkflow>
      > | null = null
      if (payload.workflowStateSnapshotId) {
        try {
          pinnedSnapshot = await snapshotService.getBoundedSnapshotForWorkflow(
            payload.workflowStateSnapshotId,
            workflowId
          )
        } catch (error) {
          throw new WorkflowExecutionAdmissionError(
            'snapshot_load_failed',
            `Failed to load pinned workflow snapshot: ${toError(error).message}`,
            { cause: error }
          )
        }
      }
      const useDraftState = pinnedSnapshot !== null || payload.useDraftState === true

      const metadata: ExecutionMetadata = {
        requestId,
        executionId,
        workflowId,
        workspaceId,
        userId: actorUserId,
        billingAttribution: preprocessResult.billingAttribution,
        sessionUserId: undefined,
        workflowUserId: workflow.userId,
        triggerType: correlation.triggerType || 'api',
        triggerBlockId: payload.triggerBlockId,
        useDraftState,
        startTime: new Date().toISOString(),
        isClientSession: false,
        ...(pinnedSnapshot
          ? {
              workflowStateOverride: {
                blocks: pinnedSnapshot.stateData.blocks,
                edges: pinnedSnapshot.stateData.edges,
                loops: pinnedSnapshot.stateData.loops,
                parallels: pinnedSnapshot.stateData.parallels,
              },
            }
          : {}),
        callChain: payload.callChain,
        correlation,
        executionMode: payload.executionMode ?? 'async',
      }

      const snapshot = new ExecutionSnapshot(
        metadata,
        workflow,
        payload.input,
        pinnedSnapshot ? (pinnedSnapshot.stateData.variables ?? {}) : workflow.variables || {},
        []
      )

      const timeoutController = createTimeoutAbortController(
        preprocessResult.executionTimeout?.async
      )
      const executionSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutController.signal])
        : timeoutController.signal

      let result
      try {
        abortSignal?.throwIfAborted()
        result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          blockMocks: payload.blockMocks,
          includeFileBase64: true,
          base64MaxBytes: undefined,
          abortSignal: executionSignal,
        })
      } finally {
        timeoutController.cleanup()
      }

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
      } else {
        await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })
      }

      await loggingSession.waitForPostExecution()

      const durationMs = result.metadata?.duration
      if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error('Workflow execution completed without valid duration metadata')
      }

      logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
        success: result.success,
        executionTime: durationMs,
        executionId,
      })

      return {
        success: result.success,
        workflowId: payload.workflowId,
        executionId,
        output: result.output,
        durationMs,
        executedAt: new Date().toISOString(),
        metadata: payload.metadata,
      }
    } catch (error: unknown) {
      logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
        error: toError(error).message,
        executionId,
      })

      if (wasExecutionFinalizedByCore(error, executionId)) {
        throw error
      }

      const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
      const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

      await loggingSession.safeCompleteWithError({
        error: {
          message: toError(error).message,
          stackTrace: error instanceof Error ? error.stack : undefined,
        },
        traceSpans,
      })

      throw error
    } finally {
      void cleanupExecutionBase64Cache(executionId)
    }
  })
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  machine: 'medium-1x',
  queue: {
    concurrencyLimit: WORKFLOW_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: executeWorkflowJob,
})
