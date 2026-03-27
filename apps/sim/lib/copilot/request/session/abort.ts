import { createLogger } from '@sim/logger'
import { clearAbortMarker, hasAbortMarker, writeAbortMarker } from './buffer'

const logger = createLogger('SessionAbort')

const activeStreams = new Map<string, AbortController>()

const DEFAULT_ABORT_POLL_MS = 1000

export function registerActiveStream(streamId: string, controller: AbortController): void {
  activeStreams.set(streamId, controller)
}

export function unregisterActiveStream(streamId: string): void {
  activeStreams.delete(streamId)
}

/**
 * Returns `true` if it aborted an in-process controller,
 * `false` if it only wrote the marker (no local controller found).
 */
export async function abortActiveStream(streamId: string): Promise<boolean> {
  await writeAbortMarker(streamId)
  const controller = activeStreams.get(streamId)
  if (!controller) return false
  controller.abort()
  activeStreams.delete(streamId)
  return true
}

const pollingStreams = new Set<string>()

export function startAbortPoller(
  streamId: string,
  abortController: AbortController,
  options?: { pollMs?: number; requestId?: string }
): ReturnType<typeof setInterval> {
  const pollMs = options?.pollMs ?? DEFAULT_ABORT_POLL_MS
  const requestId = options?.requestId

  return setInterval(() => {
    if (pollingStreams.has(streamId)) return
    pollingStreams.add(streamId)

    void (async () => {
      try {
        const shouldAbort = await hasAbortMarker(streamId)
        if (shouldAbort && !abortController.signal.aborted) {
          abortController.abort()
          await clearAbortMarker(streamId)
        }
      } catch (error) {
        logger.warn('Failed to poll stream abort marker', {
          streamId,
          ...(requestId ? { requestId } : {}),
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        pollingStreams.delete(streamId)
      }
    })()
  }, pollMs)
}

export async function cleanupAbortMarker(streamId: string): Promise<void> {
  try {
    await clearAbortMarker(streamId)
  } catch (error) {
    logger.warn('Failed to clear stream abort marker during cleanup', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
