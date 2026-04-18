import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  type RequestTraceV1Outcome,
  RequestTraceV1Outcome as RequestTraceV1OutcomeConst,
} from '@/lib/copilot/generated/request-trace-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import type { StreamWriter } from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const logger = createLogger('CopilotStreamFinalize')
// Lazy tracer resolution: see comment in lib/copilot/request/otel.ts.
const getTracer = () => trace.getTracer('sim-copilot-finalize', '1.0.0')

/**
 * Single finalization path for stream results.
 *
 * `outcome` is the classifier's resolved verdict from the caller — it
 * encodes "was this cancelled, errored, or completed" WITHOUT relying
 * on the raw `abortController.signal.aborted` boolean. That matters
 * because a client can disconnect mid-stream without the abort
 * controller ever firing (the SSE `cancel()` callback only sets
 * `publisher.clientDisconnected`); the lifecycle classifies THAT as
 * `cancelled` too, but a prior API passed `aborted: false` into this
 * function, sending us down `handleError` and persisting an `error`
 * terminal state + run status. Now the outcome is the source of truth.
 */
export async function finalizeStream(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  outcome: RequestTraceV1Outcome,
  requestId: string
): Promise<void> {
  const spanOutcome =
    outcome === RequestTraceV1OutcomeConst.cancelled
      ? 'aborted'
      : outcome === RequestTraceV1OutcomeConst.success
        ? 'success'
        : 'error'
  const span = getTracer().startSpan('copilot.finalize_stream', {
    attributes: {
      [TraceAttr.CopilotFinalizeOutcome]: spanOutcome,
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
    if (outcome === RequestTraceV1OutcomeConst.cancelled) {
      await handleAborted(result, publisher, runId, requestId)
    } else if (outcome === RequestTraceV1OutcomeConst.error) {
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
