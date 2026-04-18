import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { createExecutionEventWriter, setExecutionMeta } from '@/lib/execution/event-buffer'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import {
  createExecutionCallbacks,
  type ExecutionEvent,
} from '@/lib/workflows/executor/execution-events'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import type { BlockLog, NormalizedBlockOutput } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'

const logger = createLogger('QueuedWorkflowExecution')

export const DIRECT_WORKFLOW_JOB_NAME = 'direct-workflow-execution'

export interface QueuedWorkflowExecutionPayload {
  workflow: Record<string, any>
  metadata: ExecutionMetadata
  input: unknown
  variables: Record<string, any>
  selectedOutputs?: string[]
  includeFileBase64?: boolean
  base64MaxBytes?: number
  stopAfterBlockId?: string
  timeoutMs?: number
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
  }
  streamEvents?: boolean
}

export interface QueuedWorkflowExecutionResult {
  success: boolean
  executionId: string
  output: NormalizedBlockOutput
  error?: string
  logs?: BlockLog[]
  status: 'success' | 'cancelled' | 'paused' | 'failed'
  statusCode?: number
  metadata?: {
    duration?: number
    startTime?: string
    endTime?: string
  }
}

function buildResult(
  status: QueuedWorkflowExecutionResult['status'],
  result: {
    success: boolean
    output: NormalizedBlockOutput
    error?: string
    logs?: BlockLog[]
    metadata?: {
      duration?: number
      startTime?: string
      endTime?: string
    }
  },
  executionId: string,
  statusCode?: number
): QueuedWorkflowExecutionResult {
  return {
    success: result.success,
    executionId,
    output: result.output,
    error: result.error,
    logs: result.logs,
    status,
    statusCode,
    metadata: result.metadata,
  }
}

export async function executeQueuedWorkflowJob(
  payload: QueuedWorkflowExecutionPayload
): Promise<QueuedWorkflowExecutionResult> {
  const { metadata } = payload
  const { executionId, requestId, workflowId, triggerType } = metadata
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)
  const timeoutController = createTimeoutAbortController(payload.timeoutMs)
  const eventWriter = payload.streamEvents ? createExecutionEventWriter(executionId) : null

  if (payload.streamEvents) {
    await setExecutionMeta(executionId, {
      status: 'active',
      userId: metadata.userId,
      workflowId,
    })
  }

  try {
    const snapshot = new ExecutionSnapshot(
      metadata,
      payload.workflow,
      payload.input,
      payload.variables,
      payload.selectedOutputs ?? []
    )

    let callbacks = {}

    if (eventWriter) {
      const executionCallbacks = createExecutionCallbacks({
        executionId,
        workflowId,
        sendEvent: async (event: ExecutionEvent) => {
          await eventWriter.write(event)
        },
      })

      callbacks = {
        onBlockStart: executionCallbacks.onBlockStart,
        onBlockComplete: executionCallbacks.onBlockComplete,
        onStream: executionCallbacks.onStream,
        onChildWorkflowInstanceReady: executionCallbacks.onChildWorkflowInstanceReady,
      }

      await executionCallbacks.sendEvent({
        type: 'execution:started',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: {
          startTime: metadata.startTime,
        },
      })
    }

    const result = await executeWorkflowCore({
      snapshot,
      callbacks,
      loggingSession,
      includeFileBase64: payload.includeFileBase64,
      base64MaxBytes: payload.base64MaxBytes,
      stopAfterBlockId: payload.stopAfterBlockId,
      runFromBlock: payload.runFromBlock,
      abortSignal: timeoutController.signal,
    })

    if (
      result.status === 'cancelled' &&
      timeoutController.isTimedOut() &&
      timeoutController.timeoutMs
    ) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
      await loggingSession.markAsFailed(timeoutErrorMessage)

      if (eventWriter) {
        await eventWriter.write({
          type: 'execution:error',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            error: timeoutErrorMessage,
            duration: result.metadata?.duration || 0,
          },
        })

        await setExecutionMeta(executionId, { status: 'error' })
      }

      return buildResult(
        'cancelled',
        {
          success: false,
          output: result.output,
          error: timeoutErrorMessage,
          logs: result.logs,
          metadata: result.metadata
            ? {
                duration: result.metadata.duration,
                startTime: result.metadata.startTime,
                endTime: result.metadata.endTime,
              }
            : undefined,
        },
        executionId,
        408
      )
    }

    await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

    const outputWithBase64 = payload.includeFileBase64
      ? await hydrateUserFilesWithBase64(result.output, {
          requestId,
          executionId,
          maxBytes: payload.base64MaxBytes,
        })
      : result.output

    if (eventWriter) {
      if (result.status === 'cancelled') {
        await eventWriter.write({
          type: 'execution:cancelled',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            duration: result.metadata?.duration || 0,
          },
        })
        await setExecutionMeta(executionId, { status: 'cancelled' })
      } else if (result.status === 'paused') {
        await eventWriter.write({
          type: 'execution:paused',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            output: outputWithBase64,
            duration: result.metadata?.duration || 0,
            startTime: result.metadata?.startTime || metadata.startTime,
            endTime: result.metadata?.endTime || new Date().toISOString(),
          },
        })
        await setExecutionMeta(executionId, { status: 'complete' })
      } else {
        await eventWriter.write({
          type: 'execution:completed',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            success: result.success,
            output: outputWithBase64,
            duration: result.metadata?.duration || 0,
            startTime: result.metadata?.startTime || metadata.startTime,
            endTime: result.metadata?.endTime || new Date().toISOString(),
          },
        })
        await setExecutionMeta(executionId, { status: 'complete' })
      }
    }

    return buildResult(
      result.status === 'paused'
        ? 'paused'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'success',
      {
        success: result.success,
        output: outputWithBase64,
        error: result.error,
        logs: result.logs,
        metadata: result.metadata
          ? {
              duration: result.metadata.duration,
              startTime: result.metadata.startTime,
              endTime: result.metadata.endTime,
            }
          : undefined,
      },
      executionId
    )
  } catch (error) {
    logger.error('Queued workflow execution failed', {
      workflowId,
      executionId,
      error: toError(error).message,
    })

    if (!wasExecutionFinalizedByCore(error, executionId)) {
      const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
      const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }
      await loggingSession.safeCompleteWithError({
        error: {
          message: toError(error).message,
          stackTrace: error instanceof Error ? error.stack : undefined,
        },
        traceSpans,
      })
    }

    if (eventWriter) {
      await eventWriter.write({
        type: 'execution:error',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: {
          error: toError(error).message,
          duration: 0,
        },
      })
      await setExecutionMeta(executionId, { status: 'error' })
    }

    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

    return buildResult(
      'failed',
      {
        success: false,
        output: executionResult?.output ?? {},
        error: executionResult?.error || toError(error).message,
        logs: executionResult?.logs,
        metadata: executionResult?.metadata
          ? {
              duration: executionResult.metadata.duration,
              startTime: executionResult.metadata.startTime,
              endTime: executionResult.metadata.endTime,
            }
          : undefined,
      },
      executionId,
      500
    )
  } finally {
    timeoutController.cleanup()

    if (eventWriter) {
      await eventWriter.close()
    }

    await cleanupExecutionBase64Cache(executionId).catch((error) => {
      logger.error('Failed to cleanup queued workflow base64 cache', {
        executionId,
        error: toError(error).message,
      })
    })
  }
}
