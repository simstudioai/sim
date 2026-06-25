/**
 * Standard headers for Server-Sent Events responses
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

/**
 * Encodes data as a Server-Sent Events (SSE) message.
 * Formats the data as a JSON string prefixed with "data:" and suffixed with two newlines,
 * then encodes it as a Uint8Array for streaming.
 *
 * @param data - The data to encode and send via SSE
 * @returns The encoded SSE message as a Uint8Array
 */
export function encodeSSE(data: any): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * The sentinel value servers emit to signal end-of-stream. Lines carrying this
 * payload are skipped before reaching the consumer's `onEvent` callback.
 */
const DONE_SENTINEL = '[DONE]'

/**
 * A source the SSE reader can consume: a fetch `Response`, its `ReadableStream`
 * body, or an already-acquired reader. Passing a `Response`/stream lets the
 * primitive own `getReader()` and the reader lifecycle (lock release); passing a
 * reader is supported for callers that must acquire it first (e.g. to stash it
 * for external cancellation).
 */
export type SSESource =
  | Response
  | ReadableStream<Uint8Array>
  | ReadableStreamDefaultReader<Uint8Array>

/**
 * The result of an SSE event/line callback. Only the literal `true` (returned
 * synchronously or resolved from a `Promise`) stops processing and returns
 * early — useful for terminal events. Any other value (including the
 * `undefined` a handler that returns nothing produces) keeps processing.
 *
 * Typed as `unknown` rather than `boolean | void | Promise<boolean | void>` so
 * both sync and `async` handlers — including `async` handlers that return
 * nothing (`Promise<void>`) — stay assignable, without the confusing
 * `void`-inside-a-`Promise` union that the precise type would require.
 */
export type SSEStopSignal = unknown

/**
 * Options for {@link readSSELines} — the low-level line engine that delivers the
 * raw `data:` payload string (no JSON parsing).
 */
export interface ReadSSELinesOptions {
  /** Invoked once per SSE `data:` line with the raw (un-parsed) payload string. */
  onData: (rawData: string) => SSEStopSignal
  /** Aborts the read; checked before each chunk and between events. */
  signal?: AbortSignal
}

/**
 * Options for {@link readSSEEvents} — the JSON convenience layer over
 * {@link readSSELines}.
 */
export interface ReadSSEEventsOptions<T> {
  /**
   * Invoked once per parsed SSE `data:` event with the JSON-parsed payload.
   * Return (or resolve) `true` to stop processing and return early. Callers
   * narrow the typed payload.
   */
  onEvent: (event: T) => SSEStopSignal
  /**
   * Invoked for a `data:` line whose payload is not valid JSON. Defaults to
   * silently skipping the line. Throw from here to surface a fatal parse error.
   */
  onParseError?: (rawData: string, error: unknown) => void
  /** Aborts the read; checked before each chunk and between events. */
  signal?: AbortSignal
}

/**
 * Resolves an {@link SSESource} to a reader, reporting whether this call
 * acquired the lock (and is therefore responsible for releasing it).
 */
function toReader(source: SSESource): {
  reader: ReadableStreamDefaultReader<Uint8Array>
  ownsLock: boolean
} {
  if (source instanceof ReadableStream) {
    return { reader: source.getReader(), ownsLock: true }
  }
  if (source instanceof Response) {
    if (!source.body) throw new Error('No response body')
    return { reader: source.body.getReader(), ownsLock: true }
  }
  return { reader: source, ownsLock: false }
}

/**
 * Strips an optional trailing carriage return from a single SSE line, so both
 * `\n`- and `\r\n`-terminated framings parse identically.
 */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * The single client-side SSE decode engine. Reads a byte stream, decodes it
 * incrementally, splits it into lines, and invokes `onData` once per `data:`
 * line with its raw (un-parsed) payload string.
 *
 * It splits on `\n` and processes each `data:` line individually, which makes it
 * tolerant of BOTH `\n`- and `\n\n`-separated framings (the blank separator
 * lines between events are simply ignored). Trailing `\r` is stripped, a single
 * optional space after `data:` is consumed, and the `[DONE]` sentinel is
 * skipped. The reader's lock is always released on completion, abort, or error
 * (only when this function acquired it).
 *
 * This is the low-level engine. Most callers want {@link readSSEEvents}, which
 * adds JSON parsing on top. Reach for `readSSELines` only when the payload needs
 * custom parsing (e.g. schema-validated decoding).
 *
 * @param source - A `Response`, `ReadableStream`, or stream reader.
 * @param options - The `onData` callback plus an optional `signal`.
 */
export async function readSSELines(source: SSESource, options: ReadSSELinesOptions): Promise<void> {
  const { onData, signal } = options
  const { reader, ownsLock } = toReader(source)
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const { done, value } = await reader.read()

      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')

      for (const rawLine of lines) {
        if (signal?.aborted) return

        const line = stripCarriageReturn(rawLine)
        if (!line.startsWith('data:')) continue

        let data = line.slice(5)
        if (data.startsWith(' ')) data = data.slice(1)
        if (data === DONE_SENTINEL) continue

        if ((await onData(data)) === true) return
      }

      if (done) break
    }
  } finally {
    if (ownsLock) reader.releaseLock()
  }
}

/**
 * The JSON convenience layer over {@link readSSELines}: invokes `onEvent` once
 * per `data:` event with its JSON-parsed payload. Unparseable lines are passed
 * to `onParseError` (default: silently skipped). All framing, `\r`, `[DONE]`,
 * abort, and reader-lifecycle behavior is inherited from `readSSELines`.
 *
 * Higher-level concerns — UI batching, reconnect, error classification, event
 * dispatch — belong in the caller's `onEvent`, not here.
 *
 * @typeParam T - The parsed event type the caller expects (defaults to `unknown`).
 * @param source - A `Response`, `ReadableStream`, or stream reader.
 * @param options - The `onEvent` callback plus optional `signal`/`onParseError`.
 */
export async function readSSEEvents<T = unknown>(
  source: SSESource,
  options: ReadSSEEventsOptions<T>
): Promise<void> {
  const { onEvent, onParseError, signal } = options
  await readSSELines(source, {
    signal,
    onData: (data) => {
      let parsed: T
      try {
        parsed = JSON.parse(data) as T
      } catch (error) {
        onParseError?.(data, error)
        return
      }
      return onEvent(parsed)
    },
  })
}

/**
 * Options for reading SSE stream
 */
export interface ReadSSEStreamOptions {
  onChunk?: (chunk: string) => void
  onAccumulated?: (accumulated: string) => void
  signal?: AbortSignal
}

/**
 * Reads and parses an SSE stream from a Response body.
 * Handles the wand API SSE format with data chunks and done signals.
 *
 * @param body - The ReadableStream body from a fetch Response
 * @param options - Callbacks for handling stream data
 * @returns The accumulated content from the stream
 */
export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  options: ReadSSEStreamOptions = {}
): Promise<string> {
  const { onChunk, onAccumulated, signal } = options
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let accumulatedContent = ''
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) {
        break
      }

      const { done, value } = await reader.read()

      if (done) {
        const remaining = decoder.decode()
        if (remaining) {
          buffer += remaining
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const lineData = line.substring(6)
          if (lineData === '[DONE]') continue

          try {
            const data = JSON.parse(lineData)
            if (data.error) throw new Error(data.error)
            if (data.chunk) {
              accumulatedContent += data.chunk
              onChunk?.(data.chunk)
              onAccumulated?.(accumulatedContent)
            }
            if (data.done) break
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return accumulatedContent
}
