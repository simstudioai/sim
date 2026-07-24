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

/**
 * Classification of a `text_delta`:
 * - `'final'` / omitted — answer text; the pump projects it to the byte stream
 *   immediately (single-turn adapters, MAX-iterations flush, legacy text streams).
 * - `'intermediate'` — pre-tool commentary flushed at turn end; never projected.
 * - `'pending'` — live text from a streaming tool loop whose turn is not yet
 *   classified. The pump buffers it per turn and projects it only when the
 *   matching `turn_end` arrives with `turn: 'final'`. Sinks receive it live so
 *   opted-in clients can render the answer as it streams.
 */
export type TextDeltaClassification = TextDeltaTurn | 'pending'

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string; turn?: TextDeltaClassification }
  | {
      /**
       * Emitted by streaming tool loops when a model turn resolves. Classifies
       * every `'pending'` text_delta since the previous turn boundary:
       * `'final'` keeps the text (pump projects it to the byte stream),
       * `'intermediate'` discards it (tools follow; sinks should clear any
       * provisionally rendered text).
       */
      type: 'turn_end'
      turn: TextDeltaTurn
    }
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

export function isTextDeltaClassification(value: unknown): value is TextDeltaClassification {
  return isTextDeltaTurn(value) || value === 'pending'
}

export function isAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  switch (value.type) {
    case 'text_delta':
      return (
        typeof value.text === 'string' &&
        (value.turn === undefined || isTextDeltaClassification(value.turn))
      )
    case 'turn_end':
      return isTextDeltaTurn(value.turn)
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

/**
 * Projects an already-settled provider answer onto the canonical stream without
 * asking the model to generate it a second time.
 */
export function createSettledAgentEventStream(content: string): ReadableStream<AgentStreamEvent> {
  return createAgentEventReadableStream(
    content ? [{ type: 'text_delta', text: content, turn: 'final' }] : []
  )
}
