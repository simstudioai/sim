/**
 * Bridges an agent-events provider sink onto the execution-events SSE
 * vocabulary (`stream:thinking` / `stream:tool`). Shared by the workflow
 * execute route and the HITL resume manager so the mapping cannot drift.
 *
 * Must be called in the caller's sync window (before awaiting the text
 * reader) so the executor pump registers the sink before pulling provider
 * chunks.
 */

import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import type { StreamingExecution } from '@/executor/types'

export interface ForwardAgentStreamEventsOptions {
  blockId: string
  executionId: string
  workflowId: string
  sendEvent: (event: ExecutionEvent) => void | Promise<void>
}

/**
 * Subscribes to the streaming execution's agent-events sink and forwards
 * thinking deltas and tool lifecycle as execution events. Text deltas are
 * intentionally not forwarded — answer text reaches clients via the block's
 * byte stream (`stream:chunk`). Returns an unsubscribe function (no-op when
 * the execution has no sink).
 */
export function forwardAgentStreamToExecutionEvents(
  streamingExec: StreamingExecution,
  options: ForwardAgentStreamEventsOptions
): () => void {
  if (!streamingExec.subscribe) {
    return () => {}
  }

  const { blockId, executionId, workflowId, sendEvent } = options

  return streamingExec.subscribe({
    onEvent: async (event) => {
      if (event.type === 'thinking_delta') {
        await sendEvent({
          type: 'stream:thinking',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, text: event.text },
        })
        return
      }
      if (event.type === 'tool_call_start') {
        await sendEvent({
          type: 'stream:tool',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, phase: 'start', id: event.id, name: event.name },
        })
        return
      }
      if (event.type === 'tool_call_end') {
        await sendEvent({
          type: 'stream:tool',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, phase: 'end', id: event.id, name: event.name, status: event.status },
        })
      }
    },
  })
}
