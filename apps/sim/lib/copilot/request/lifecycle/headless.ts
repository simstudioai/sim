import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { RequestTraceV1Outcome as RequestTraceOutcome } from '@/lib/copilot/generated/request-trace-v1'
import {
  RequestTraceV1Outcome,
  RequestTraceV1SpanStatus,
} from '@/lib/copilot/generated/request-trace-v1'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'
import { reportTrace, TraceCollector } from '@/lib/copilot/request/trace'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const logger = createLogger('CopilotHeadlessLifecycle')

export async function runHeadlessCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const simRequestId =
    typeof options.simRequestId === 'string' && options.simRequestId.length > 0
      ? options.simRequestId
      : typeof requestPayload.messageId === 'string' && requestPayload.messageId.length > 0
        ? requestPayload.messageId
        : generateId()
  const trace = new TraceCollector()
  const requestSpan = trace.startSpan('Headless Mothership Request', 'request', {
    route: options.goRoute,
    workflowId: options.workflowId,
    workspaceId: options.workspaceId,
    chatId: options.chatId,
  })

  let result: OrchestratorResult | undefined
  let outcome: RequestTraceOutcome = RequestTraceV1Outcome.error

  try {
    result = await runCopilotLifecycle(requestPayload, {
      ...options,
      trace,
      simRequestId,
    })
    outcome = options.abortSignal?.aborted
      ? RequestTraceV1Outcome.cancelled
      : result.success
        ? RequestTraceV1Outcome.success
        : RequestTraceV1Outcome.error
    return result
  } catch (error) {
    outcome = options.abortSignal?.aborted
      ? RequestTraceV1Outcome.cancelled
      : RequestTraceV1Outcome.error
    throw error
  } finally {
    trace.endSpan(
      requestSpan,
      outcome === RequestTraceV1Outcome.success
        ? RequestTraceV1SpanStatus.ok
        : outcome === RequestTraceV1Outcome.cancelled
          ? RequestTraceV1SpanStatus.cancelled
          : RequestTraceV1SpanStatus.error
    )

    try {
      await reportTrace(
        trace.build({
          outcome,
          simRequestId,
          chatId: result?.chatId ?? options.chatId,
          runId: options.runId,
          executionId: options.executionId,
          usage: result?.usage,
          cost: result?.cost,
        })
      )
    } catch (error) {
      logger.warn('Failed to report headless trace', {
        simRequestId,
        chatId: result?.chatId ?? options.chatId,
        error: toError(error).message,
      })
    }
  }
}
