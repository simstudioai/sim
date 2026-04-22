import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { RequestTraceV1Outcome as RequestTraceOutcome } from '@/lib/copilot/generated/request-trace-v1'
import {
  RequestTraceV1Outcome,
  RequestTraceV1SpanStatus,
} from '@/lib/copilot/generated/request-trace-v1'
import { CopilotTransport } from '@/lib/copilot/generated/trace-attribute-values-v1'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'
import { withCopilotOtelContext } from '@/lib/copilot/request/otel'
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

  return withCopilotOtelContext(
    {
      requestId: simRequestId,
      route: options.goRoute,
      chatId: options.chatId,
      workflowId: options.workflowId,
      executionId: options.executionId,
      runId: options.runId,
      transport: CopilotTransport.Headless,
    },
    async (otelContext) => {
      try {
        result = await runCopilotLifecycle(requestPayload, {
          ...options,
          trace,
          simRequestId,
          otelContext,
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
          // Best-effort extraction of the prompt from the untyped
          // headless payload. Keeps parity with the streaming path
          // where `message` is destructured directly.
          const userMessage =
            typeof requestPayload.message === 'string' ? requestPayload.message : undefined
          await reportTrace(
            trace.build({
              outcome,
              simRequestId,
              chatId: result?.chatId ?? options.chatId,
              runId: options.runId,
              executionId: options.executionId,
              userMessage,
              usage: result?.usage,
              cost: result?.cost,
            }),
            otelContext
          )
        } catch (error) {
          logger.warn('Failed to report headless trace', {
            simRequestId,
            chatId: result?.chatId ?? options.chatId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  )
}
