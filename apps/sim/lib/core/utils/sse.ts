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
