import { createLogger } from '@sim/logger'
import { toError } from '@/lib/core/utils/helpers'

const logger = createLogger('CopilotSseParser')

export class FatalSseEventError extends Error {}

function createParseFailure(message: string, preview: string): FatalSseEventError {
  logger.error(message, { preview })
  return new FatalSseEventError(message)
}

function normalizeSseLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Processes an SSE stream by calling onEvent for each parsed event.
 *
 * @param onEvent Called per parsed event. Return true to stop processing.
 */
export async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  abortSignal: AbortSignal | undefined,
  onEvent: (event: unknown) => boolean | undefined | Promise<boolean | undefined>
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
          const normalizedLine = normalizeSseLine(line)
          if (abortSignal?.aborted) {
            logger.info('SSE stream aborted mid-chunk (between events)')
            return
          }
          if (!normalizedLine.trim()) continue
          if (!normalizedLine.startsWith('data: ')) continue

          const jsonStr = normalizedLine.slice(6)
          if (jsonStr === '[DONE]') continue

          let parsed: unknown
          try {
            parsed = JSON.parse(jsonStr)
          } catch (error) {
            const preview = jsonStr.slice(0, 200)
            const detail = toError(error).message
            throw createParseFailure(`Failed to parse SSE event JSON: ${detail}`, preview)
          }

          try {
            if (await onEvent(parsed)) {
              stopped = true
              break
            }
          } catch (error) {
            if (error instanceof FatalSseEventError) {
              throw error
            }
            logger.warn('Failed to handle SSE event', {
              preview: jsonStr.slice(0, 200),
              error: toError(error).message,
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

    const normalizedBuffer = normalizeSseLine(buffer)
    if (normalizedBuffer.trim() && normalizedBuffer.startsWith('data: ')) {
      const jsonStr = normalizedBuffer.slice(6)
      if (jsonStr === '[DONE]') {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonStr)
      } catch (error) {
        const preview = normalizedBuffer.slice(0, 200)
        const detail = toError(error).message
        throw createParseFailure(`Failed to parse final SSE buffer JSON: ${detail}`, preview)
      }

      try {
        await onEvent(parsed)
      } catch (error) {
        if (error instanceof FatalSseEventError) {
          throw error
        }
        logger.warn('Failed to handle final SSE event', {
          preview: normalizedBuffer.slice(0, 200),
          error: toError(error).message,
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
