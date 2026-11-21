import { generateId } from '@sim/utils/id'
import type { ChatRequest } from '@/lib/mothership/generated/protocol'
import { CopilotTransport } from '@/lib/mothership/observability/trace-attribute-values'
import type { CopilotLifecycleOptions } from '@/lib/mothership/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/mothership/request/lifecycle/run'
import { withCopilotOtelContext } from '@/lib/mothership/request/otel'
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
    (otelContext) =>
      runCopilotLifecycle(
        { ...requestPayload },
        { ...options, interactive: false, simRequestId, otelContext }
      )
  )
}
