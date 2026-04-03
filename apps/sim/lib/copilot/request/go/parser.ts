import { createLogger } from '@sim/logger'

const logger = createLogger('CopilotSseParser')

/**
 * Processes an SSE stream by calling onEvent synchronously for each parsed event
 * within a single reader.read() chunk. All events from one chunk are processed
 * in the same microtask — no yield/next() boundaries between them.
 *
 * Replaces the async generator approach which incurred 2 microtask yields per
 * event (one for yield, one for the consumer's next() resumption).
 *
 * @param onEvent Called synchronously per parsed event. Return true to stop processing.
 */
export async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  abortSignal: AbortSignal | undefined,
  onEvent: (event: unknown) => boolean | undefined
): Promise<void> {
  let buffer = ''

  try {
    try {
      while (true) {
        if (abortSignal?.aborted) {
          logger.info('SSE stream aborted by signal')
          break
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let stopped = false
        for (const line of lines) {
          if (abortSignal?.aborted) {
            logger.info('SSE stream aborted mid-chunk (between events)')
            return
          }
          if (!line.trim()) continue
          if (!line.startsWith('data: ')) continue

          const jsonStr = line.slice(6)
          if (jsonStr === '[DONE]') continue

          try {
            if (onEvent(JSON.parse(jsonStr))) {
              stopped = true
              break
            }
          } catch (error) {
            logger.warn('Failed to parse SSE event', {
              preview: jsonStr.slice(0, 200),
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        if (stopped) break
      }
    } catch (error) {
      const aborted =
        abortSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
      if (aborted) {
        logger.info('SSE stream read aborted')
        return
      }
      throw error
    }

    if (buffer.trim() && buffer.startsWith('data: ')) {
      try {
        onEvent(JSON.parse(buffer.slice(6)))
      } catch (error) {
        logger.warn('Failed to parse final SSE buffer', {
          preview: buffer.slice(0, 200),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      logger.warn('Failed to release SSE reader lock')
    }
  }
}
