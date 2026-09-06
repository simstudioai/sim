import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { readSSELines } from '@/lib/core/utils/sse'

const logger = createLogger('CopilotSseParser')

export class FatalSseEventError extends Error {}

/** A missing prefix can be recovered by reattaching with the last applied text position. */
export class StreamContinuityError extends FatalSseEventError {}

function createParseFailure(message: string, preview: string): FatalSseEventError {
  logger.error(message, { preview })
  return new FatalSseEventError(message)
}

/**
 * The mothership layer over the one SSE decode engine ({@link readSSELines}):
 * JSON-parses each `data:` payload, treats an unparseable payload as FATAL (the
 * wire is a typed protocol — garbage means the stream is broken, not skippable),
 * and contains per-event handler failures to a warn unless the handler itself
 * declares them fatal. Framing, `\r`, `[DONE]`, abort, and tail-flush behavior
 * all come from the shared engine.
 *
 * @param onEvent Called per parsed event. Return true to stop processing.
 */
export async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal: AbortSignal | undefined,
  onEvent: (event: unknown) => boolean | undefined | Promise<boolean | undefined>
): Promise<void> {
  try {
    await readSSELines(reader, {
      signal: abortSignal,
      onData: async (jsonStr) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(jsonStr)
        } catch (error) {
          const detail = toError(error).message
          throw createParseFailure(
            `Failed to parse SSE event JSON: ${detail}`,
            jsonStr.slice(0, 200)
          )
        }
        try {
          return (await onEvent(parsed)) === true
        } catch (error) {
          if (error instanceof FatalSseEventError) throw error
          logger.warn('Failed to handle SSE event', {
            preview: jsonStr.slice(0, 200),
            error: toError(error).message,
          })
          return false
        }
      },
    })
  } catch (error) {
    const aborted =
      abortSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
    if (aborted) {
      logger.info('SSE stream read aborted')
      return
    }
    /** A retry must release the abandoned body before a new leg attaches to the owner. */
    await reader.cancel(error).catch(() => logger.warn('Failed to cancel the failed SSE body'))
    throw error
  } finally {
    // The engine only releases locks it acquired; this reader is caller-supplied,
    // and the pre-unification behavior (always release here) is part of the contract.
    try {
      reader.releaseLock()
    } catch {
      logger.warn('Failed to release SSE reader lock')
    }
  }
}
