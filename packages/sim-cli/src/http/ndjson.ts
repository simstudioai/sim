import { SimApiError } from './client'

/**
 * Parses a newline-delimited JSON response incrementally and releases its
 * reader when the consumer reaches a terminal event or stops early.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array> | null,
  protocol: string
): AsyncGenerator<unknown> {
  if (!body) {
    throw new SimApiError(`${protocol} ended without a response body`, 0)
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const parse = (line: string): unknown => {
    const trimmed = line.trim()
    if (!trimmed) return undefined
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new SimApiError(`${protocol} returned malformed data`, 0)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const event = parse(line)
        if (event !== undefined) yield event
      }

      if (done) return
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
