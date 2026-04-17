import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import type { StreamWriter } from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const logger = createLogger('CopilotStreamFinalize')
// Lazy tracer resolution: see comment in lib/copilot/request/otel.ts.
const getTracer = () => trace.getTracer('sim-copilot-finalize', '1.0.0')

/**
 * Single finalization path for stream results.
 * Handles abort / error / success and publishes the terminal event.
 * Replaces duplicated blocks in the old chat-streaming.ts.
 */
export async function finalizeStream(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  aborted: boolean,
  requestId: string
): Promise<void> {
  const outcome = aborted ? 'aborted' : result.success ? 'success' : 'error'
  const span = getTracer().startSpan('copilot.finalize_stream', {
    attributes: {
      [TraceAttr.CopilotFinalizeOutcome]: outcome,
      'copilot.run.id': runId,
      'copilot.request.id': requestId,
      [TraceAttr.CopilotResultToolCalls]: result.toolCalls?.length ?? 0,
      [TraceAttr.CopilotResultContentBlocks]: result.contentBlocks?.length ?? 0,
      [TraceAttr.CopilotResultContentLength]: result.content?.length ?? 0,
      [TraceAttr.CopilotPublisherSawComplete]: publisher.sawComplete,
      [TraceAttr.CopilotPublisherClientDisconnected]: publisher.clientDisconnected,
    },
  })
  try {
    if (aborted) {
      await handleAborted(result, publisher, runId, requestId)
    } else if (!result.success) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: result.error || 'orchestration failed',
      })
      await handleError(result, publisher, runId, requestId)
    } else {
      await handleSuccess(publisher, runId, requestId)
    }
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)))
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'finalize threw' })
    throw error
  } finally {
    span.end()
  }
}

async function handleAborted(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  const partialContentLen = result.content?.length ?? 0
  const toolCallCount = result.toolCalls?.length ?? 0
  const blockCount = result.contentBlocks?.length ?? 0
  logger.info(`[${requestId}] Stream aborted by explicit stop`, {
    partialContentLen,
    toolCallCount,
    blockCount,
  })
  if (!publisher.sawComplete) {
    const partialContent = result.content || undefined
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: MothershipStreamV1CompletionStatus.cancelled,
        ...(partialContent ? { partialContent } : {}),
        ...(partialContentLen ? { partialContentLen } : {}),
        ...(toolCallCount ? { toolCallCount } : {}),
      },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.cancelled, requestId, {
    completedAt: new Date(),
  })
}

async function handleError(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  const errorMessage =
    result.error ||
    result.errors?.[0] ||
    'An unexpected error occurred while processing the response.'

  if (publisher.clientDisconnected) {
    logger.info(`[${requestId}] Stream failed after client disconnect`, { error: errorMessage })
  }
  logger.error(`[${requestId}] Orchestration returned failure`, { error: errorMessage })

  await publisher.publish({
    type: MothershipStreamV1EventType.error,
    payload: {
      message: errorMessage,
      error: errorMessage,
      data: { displayMessage: 'An unexpected error occurred while processing the response.' },
    },
  })
  if (!publisher.sawComplete) {
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: { status: MothershipStreamV1CompletionStatus.error },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.error, requestId, {
    completedAt: new Date(),
    error: errorMessage,
  })
}

async function handleSuccess(
  publisher: StreamWriter,
  runId: string,
  requestId: string
): Promise<void> {
  if (!publisher.sawComplete) {
    await publisher.publish({
      type: MothershipStreamV1EventType.complete,
      payload: { status: MothershipStreamV1CompletionStatus.complete },
    })
  }
  await publisher.flush()
  await loggedRunStatusUpdate(runId, MothershipStreamV1CompletionStatus.complete, requestId, {
    completedAt: new Date(),
  })
}

async function loggedRunStatusUpdate(
  runId: string,
  status: Parameters<typeof updateRunStatus>[1],
  requestId: string,
  updates: Parameters<typeof updateRunStatus>[2] = {}
): Promise<void> {
  try {
    await updateRunStatus(runId, status, updates)
  } catch (error) {
    logger.warn(`[${requestId}] Failed to update run status to ${status}`, {
      runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
