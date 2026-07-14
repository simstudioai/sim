/**
 * Sync-window helper: attach an agent-events sink before the first await
 * so the executor pump can deliver thinking/tool events while the answer
 * stream is drained separately.
 */

import type { StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent } from '@/providers/stream-events'

export type AgentStreamSinkHandlers = {
  onThinkingDelta?: (text: string) => void | Promise<void>
  onToolCallStart?: (id: string, name: string) => void | Promise<void>
  onToolCallEnd?: (
    id: string,
    name: string,
    status: 'success' | 'error' | 'cancelled'
  ) => void | Promise<void>
}

/**
 * Subscribe in the caller's sync window (before awaiting the text reader).
 * Returns an unsubscribe function (no-op when subscribe is absent).
 */
export function attachAgentStreamSink(
  streamingExec: StreamingExecution,
  handlers: AgentStreamSinkHandlers
): () => void {
  if (!streamingExec.subscribe) {
    return () => {}
  }

  return streamingExec.subscribe({
    onEvent: async (event: AgentStreamEvent) => {
      if (event.type === 'thinking_delta') {
        await handlers.onThinkingDelta?.(event.text)
        return
      }
      if (event.type === 'tool_call_start') {
        await handlers.onToolCallStart?.(event.id, event.name)
        return
      }
      if (event.type === 'tool_call_end') {
        await handlers.onToolCallEnd?.(event.id, event.name, event.status)
      }
    },
  })
}
