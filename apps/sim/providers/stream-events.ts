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

export const AGENT_STREAM_FORMATS = ['text', 'agent-events-v1'] as const

export type AgentStreamFormat = (typeof AGENT_STREAM_FORMATS)[number]

export const AGENT_STREAM_EVENT_TYPES = [
  'text_delta',
  'thinking_delta',
  'tool_call_start',
  'tool_call_end',
] as const

export type AgentStreamEventType = (typeof AGENT_STREAM_EVENT_TYPES)[number]

export const TOOL_CALL_END_STATUSES = ['success', 'error', 'cancelled'] as const

export type ToolCallEndStatus = (typeof TOOL_CALL_END_STATUSES)[number]

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

export function isAgentStreamFormat(value: unknown): value is AgentStreamFormat {
  return value === 'text' || value === 'agent-events-v1'
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
        typeof value.text === 'string' &&
        (value.turn === undefined || isTextDeltaTurn(value.turn))
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
 * Narrows a {@link ReadableStream} to an agent-events object stream.
 * Callers must also check `streamFormat === 'agent-events-v1'` on the envelope —
 * do not sniff chunk types from the stream.
 */
export function isAgentEventReadableStream(
  stream: ReadableStream<unknown>,
  streamFormat: AgentStreamFormat
): stream is ReadableStream<AgentStreamEvent> {
  return streamFormat === 'agent-events-v1'
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
