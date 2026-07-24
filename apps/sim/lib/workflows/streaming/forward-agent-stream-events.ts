/**
 * Bridges an agent-events provider sink onto the execution-events SSE
 * vocabulary (`stream:thinking` / `stream:tool`, and optionally live answer
 * text as `stream:chunk` + `stream:chunk_reset`). Shared by the workflow
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
  /**
   * When true, answer text deltas forward live as `stream:chunk` events and an
   * intermediate `turn_end` forwards as `stream:chunk_reset`. The caller MUST
   * then stop emitting `stream:chunk` from the block's byte stream, or clients
   * receive the final turn's text twice. Never enable for response-format
   * projected streams ({@link StreamingExecution.clientStreamTransformed}).
   */
  forwardAnswerText?: boolean
}

/**
 * Returns true when the caller should source `stream:chunk` events from the
 * sink (via {@link forwardAgentStreamToExecutionEvents} with
 * `forwardAnswerText`) instead of the block's byte stream.
 */
export function shouldForwardAnswerTextFromSink(streamingExec: StreamingExecution): boolean {
  return Boolean(streamingExec.subscribe) && streamingExec.clientStreamTransformed !== true
}

/**
 * Subscribes to the streaming execution's agent-events sink and forwards
 * thinking deltas and tool lifecycle as execution events. With
 * {@link ForwardAgentStreamEventsOptions.forwardAnswerText}, answer text also
 * forwards live (`pending` deltas stream as the model generates; a
 * `chunk_reset` clears turns that resolve to tool calls). Returns an
 * unsubscribe function (no-op when the execution has no sink).
 */
export function forwardAgentStreamToExecutionEvents(
  streamingExec: StreamingExecution,
  options: ForwardAgentStreamEventsOptions
): () => void {
  if (!streamingExec.subscribe) {
    return () => {}
  }

  const { blockId, executionId, workflowId, sendEvent, forwardAnswerText = false } = options
  let emittedSinceReset = false

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
        return
      }
      if (!forwardAnswerText) {
        return
      }
      if (event.type === 'text_delta') {
        if (event.turn === 'intermediate' || !event.text) return
        emittedSinceReset = true
        await sendEvent({
          type: 'stream:chunk',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId, chunk: event.text },
        })
        return
      }
      if (event.type === 'turn_end' && event.turn === 'intermediate' && emittedSinceReset) {
        emittedSinceReset = false
        await sendEvent({
          type: 'stream:chunk_reset',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { blockId },
        })
      }
    },
  })
}
