import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  type RequestTraceV1Outcome,
  RequestTraceV1Outcome as RequestTraceV1OutcomeConst,
} from '@/lib/copilot/generated/request-trace-v1'
import { CopilotFinalizeOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import type { StreamWriter } from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const logger = createLogger('CopilotStreamFinalize')
const getTracer = () => trace.getTracer('sim-copilot-finalize', '1.0.0')

// Single finalization path. `outcome` is the caller's resolved verdict
// so we don't have to re-derive cancel vs error from raw signals.
export async function finalizeStream(
  result: OrchestratorResult,
  publisher: StreamWriter,
  runId: string,
  outcome: RequestTraceV1Outcome,
  requestId: string
): Promise<void> {
  const spanOutcome =
    outcome === RequestTraceV1OutcomeConst.cancelled
      ? CopilotFinalizeOutcome.Aborted
      : outcome === RequestTraceV1OutcomeConst.success
        ? CopilotFinalizeOutcome.Success
        : CopilotFinalizeOutcome.Error
  const span = getTracer().startSpan(TraceSpan.CopilotFinalizeStream, {
    attributes: {
      [TraceAttr.CopilotFinalizeOutcome]: spanOutcome,
      [TraceAttr.RunId]: runId,
      [TraceAttr.RequestId]: requestId,
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
    // Successful + cancelled paths fall through as status-unset → set
    // OK so dashboards don't show "incomplete" for normal terminals.
    if (outcome !== RequestTraceV1OutcomeConst.error) {
      span.setStatus({ code: SpanStatusCode.OK })
    }
  } catch (error) {
    span.recordException(toError(error))
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
      error: toError(error).message,
    })
  }
}
