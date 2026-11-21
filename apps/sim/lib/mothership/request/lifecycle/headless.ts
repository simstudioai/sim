import { generateId } from '@sim/utils/id'
import type { ChatRequest } from '@/lib/mothership/generated/protocol'
import { CopilotTransport } from '@/lib/mothership/generated/trace-attribute-values-v1'
import type { CopilotLifecycleOptions } from '@/lib/mothership/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/mothership/request/lifecycle/run'
import { withCopilotOtelContext } from '@/lib/mothership/request/otel'
import {
  RequestTraceOutcome,
  RequestTraceSpanStatus,
  TraceCollector,
} from '@/lib/mothership/request/trace'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

export async function runHeadlessCopilotLifecycle(
  requestPayload: ChatRequest | Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const simRequestId =
    typeof options.simRequestId === 'string' && options.simRequestId.length > 0
      ? options.simRequestId
      : typeof requestPayload.messageId === 'string' && requestPayload.messageId.length > 0
        ? requestPayload.messageId
        : generateId()
  const trace = new TraceCollector()
  const requestSpan = trace.startSpan('Headless Sim Agent Request', 'request', {
    route: options.workerRoute,
    workflowId: options.workflowId,
    workspaceId: options.workspaceId,
    chatId: options.chatId,
  })

  let result: OrchestratorResult | undefined
  let outcome: RequestTraceOutcome = RequestTraceOutcome.error

  return withCopilotOtelContext(
    {
      requestId: simRequestId,
      route: options.workerRoute,
      chatId: options.chatId,
      workflowId: options.workflowId,
      executionId: options.executionId,
      runId: options.runId,
      transport: CopilotTransport.Headless,
    },
    async (otelContext) => {
      try {
        result = await runCopilotLifecycle(
          { ...requestPayload },
          {
            ...options,
            interactive: false,
            trace,
            simRequestId,
            otelContext,
          }
        )
        outcome = result.success
          ? RequestTraceOutcome.success
          : options.abortSignal?.aborted || result.cancelled
            ? RequestTraceOutcome.cancelled
            : RequestTraceOutcome.error
        return result
      } catch (error) {
        outcome = options.abortSignal?.aborted
          ? RequestTraceOutcome.cancelled
          : RequestTraceOutcome.error
        throw error
      } finally {
        trace.endSpan(
          requestSpan,
          outcome === RequestTraceOutcome.success
            ? RequestTraceSpanStatus.ok
            : outcome === RequestTraceOutcome.cancelled
              ? RequestTraceSpanStatus.cancelled
              : RequestTraceSpanStatus.error
        )
      }
    }
  )
}
