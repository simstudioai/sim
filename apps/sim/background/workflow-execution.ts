import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { generateId } from '@/lib/core/utils/uuid'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
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
    triggerType: payload.triggerType || payload.correlation?.triggerType || 'api',
  }
}

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  workspaceId?: string
  input?: any
  triggerType?: CoreTriggerType
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  metadata?: Record<string, any>
  callChain?: string[]
}

/**
 * Background workflow execution job
 * @see preprocessExecution For detailed information on preprocessing checks
 * @see executeWorkflowCore For the core workflow execution logic
 */
export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const correlation = buildWorkflowCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId

  logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  const triggerType = (correlation.triggerType || 'api') as CoreTriggerType
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    const preprocessResult = await preprocessExecution({
      workflowId: payload.workflowId,
      userId: payload.userId,
      triggerType: triggerType,
      executionId: executionId,
      requestId: requestId,
      checkRateLimit: true,
      checkDeployment: true,
      loggingSession: loggingSession,
      triggerData: { correlation },
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
      sessionUserId: undefined,
      workflowUserId: workflow.userId,
      triggerType: payload.triggerType || 'api',
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      callChain: payload.callChain,
      correlation,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      payload.input,
      workflow.variables || {},
      []
    )

    const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.async)

    let result
    try {
      result = await executeWorkflowCore({
        snapshot,
        callbacks: {},
        loggingSession,
        includeFileBase64: true,
        base64MaxBytes: undefined,
        abortSignal: timeoutController.signal,
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
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    })

    if (wasExecutionFinalizedByCore(error, executionId)) {
      throw error
    }

    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      error: {
        message: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
    })

    throw error
  }
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  machine: 'medium-1x',
  run: executeWorkflowJob,
})
