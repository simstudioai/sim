import { createLogger } from '@sim/logger'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotSseParser')

/**
 * Parses SSE streams from the copilot backend into typed events.
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  abortSignal?: AbortSignal
): AsyncGenerator<SSEEvent> {
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
            const event = JSON.parse(jsonStr) as SSEEvent
            if (event?.type) {
              yield event
            }
          } catch (error) {
            logger.warn('Failed to parse SSE event', {
              preview: jsonStr.slice(0, 200),
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
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
        const event = JSON.parse(buffer.slice(6)) as SSEEvent
        if (event?.type) {
          yield event
        }
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
