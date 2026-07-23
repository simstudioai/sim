/**
 * Canonical agent stream event contract (provider → executor).
 *
 * Providers with `streamFormat: 'agent-events-v1'` return a
 * `ReadableStream<AgentStreamEvent>` (in-process object stream — not NDJSON).
 * Legacy providers keep `streamFormat: 'text'` and `ReadableStream<Uint8Array>`.
 *
 * The executor is the only consumer that projects these events into a text
 * stream + optional sink; downstream SSE/chat must not re-parse provider streams.
 */

export type AgentStreamFormat = 'text' | 'agent-events-v1'

export type ToolCallEndStatus = 'success' | 'error' | 'cancelled'

export type TextDeltaTurn = 'intermediate' | 'final'

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string; turn?: TextDeltaTurn }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | {
      type: 'tool_call_end'
      id: string
      name: string
      status: ToolCallEndStatus
    }

/** Optional sink the executor pump pushes the full ordered timeline into. */
export type AgentStreamSink = {
  onEvent: (event: AgentStreamEvent) => void | Promise<void>
}

export type UnsubscribeAgentStreamSink = () => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isToolCallEndStatus(value: unknown): value is ToolCallEndStatus {
  return value === 'success' || value === 'error' || value === 'cancelled'
}

export function isTextDeltaTurn(value: unknown): value is TextDeltaTurn {
  return value === 'intermediate' || value === 'final'
}

export function isAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  switch (value.type) {
    case 'text_delta':
      return (
        typeof value.text === 'string' && (value.turn === undefined || isTextDeltaTurn(value.turn))
      )
    case 'thinking_delta':
      return typeof value.text === 'string'
    case 'tool_call_start':
      return typeof value.id === 'string' && typeof value.name === 'string'
    case 'tool_call_end':
      return (
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        isToolCallEndStatus(value.status)
      )
    default:
      return false
  }
}

/**
 * Builds a {@link ReadableStream} that enqueues the given agent events in order.
 * Intended for tests and provider adapters that already have an event sequence.
 */
export function createAgentEventReadableStream(
  events: Iterable<AgentStreamEvent> | AsyncIterable<AgentStreamEvent>
): ReadableStream<AgentStreamEvent> {
  const iterator =
    Symbol.asyncIterator in events
      ? events[Symbol.asyncIterator]()
      : (async function* () {
          for (const event of events as Iterable<AgentStreamEvent>) {
            yield event
          }
        })()

  return new ReadableStream<AgentStreamEvent>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next()
        if (done) {
          controller.close()
          return
        }
        if (!isAgentStreamEvent(value)) {
          controller.error(new Error('Invalid AgentStreamEvent enqueued on object stream'))
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      if (typeof iterator.return === 'function') {
        await iterator.return(reason)
      }
    },
  })
}
