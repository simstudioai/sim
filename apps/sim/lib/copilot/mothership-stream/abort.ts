import { createLogger } from '@sim/logger'
import { clearAbortMarker, hasAbortMarker, writeAbortMarker } from './outbox'

const logger = createLogger('MothershipStreamAbort')

const activeStreams = new Map<string, AbortController>()

const DEFAULT_ABORT_POLL_MS = 1000

export function registerActiveStream(streamId: string, controller: AbortController): void {
  activeStreams.set(streamId, controller)
}

export function unregisterActiveStream(streamId: string): void {
  activeStreams.delete(streamId)
}

export async function abortActiveStream(streamId: string): Promise<boolean> {
  await writeAbortMarker(streamId)
  const controller = activeStreams.get(streamId)
  if (!controller) return true
  controller.abort()
  activeStreams.delete(streamId)
  return true
}

export function startAbortPoller(
  streamId: string,
  abortController: AbortController,
  options?: { pollMs?: number; requestId?: string }
): ReturnType<typeof setInterval> {
  const pollMs = options?.pollMs ?? DEFAULT_ABORT_POLL_MS
  const requestId = options?.requestId

  return setInterval(() => {
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
