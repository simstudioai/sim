import { createLogger } from '@sim/logger'
import { acquireLock, getRedisClient, releaseLock } from '@/lib/core/config/redis'
import { sleep, toError } from '@/lib/core/utils/helpers'
import { clearAbortMarker, hasAbortMarker, writeAbortMarker } from './buffer'

const logger = createLogger('SessionAbort')

const activeStreams = new Map<string, AbortController>()
const pendingChatStreams = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; streamId: string }
>()

const DEFAULT_ABORT_POLL_MS = 1000
const CHAT_STREAM_LOCK_TTL_SECONDS = 2 * 60 * 60

function registerPendingChatStream(chatId: string, streamId: string): void {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  pendingChatStreams.set(chatId, { promise, resolve, streamId })
}

function resolvePendingChatStream(chatId: string, streamId: string): void {
  const entry = pendingChatStreams.get(chatId)
  if (entry && entry.streamId === streamId) {
    entry.resolve()
    pendingChatStreams.delete(chatId)
  }
}

function getChatStreamLockKey(chatId: string): string {
  return `copilot:chat-stream-lock:${chatId}`
}

export function registerActiveStream(streamId: string, controller: AbortController): void {
  activeStreams.set(streamId, controller)
}

export function unregisterActiveStream(streamId: string): void {
  activeStreams.delete(streamId)
}

export async function waitForPendingChatStream(
  chatId: string,
  timeoutMs = 5_000,
  expectedStreamId?: string
): Promise<boolean> {
  const redis = getRedisClient()
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const entry = pendingChatStreams.get(chatId)
    const localPending = !!entry && (!expectedStreamId || entry.streamId === expectedStreamId)

    if (redis) {
      try {
        const ownerStreamId = await redis.get(getChatStreamLockKey(chatId))
        const lockReleased =
          !ownerStreamId || (expectedStreamId !== undefined && ownerStreamId !== expectedStreamId)
        if (!localPending && lockReleased) {
          return true
        }
      } catch (error) {
        logger.warn('Failed to inspect chat stream lock while waiting', {
          chatId,
          expectedStreamId,
          error: toError(error).message,
        })
      }
    } else if (!localPending) {
      return true
    }

    if (Date.now() >= deadline) {
      return false
    }
    await sleep(200)
  }
}

export async function getPendingChatStreamId(chatId: string): Promise<string | null> {
  const localEntry = pendingChatStreams.get(chatId)
  if (localEntry?.streamId) {
    return localEntry.streamId
  }

  const redis = getRedisClient()
  if (!redis) {
    return null
  }

  try {
    return (await redis.get(getChatStreamLockKey(chatId))) || null
  } catch (error) {
    logger.warn('Failed to load chat stream lock owner', {
      chatId,
      error: toError(error).message,
    })
    return null
  }
}

export async function releasePendingChatStream(chatId: string, streamId: string): Promise<void> {
  try {
    await releaseLock(getChatStreamLockKey(chatId), streamId)
  } catch (error) {
    logger.warn('Failed to release chat stream lock', {
      chatId,
      streamId,
      error: toError(error).message,
    })
  } finally {
    resolvePendingChatStream(chatId, streamId)
  }
}

export async function acquirePendingChatStream(
  chatId: string,
  streamId: string,
  timeoutMs = 5_000
): Promise<boolean> {
  const redis = getRedisClient()
  if (redis) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const acquired = await acquireLock(
          getChatStreamLockKey(chatId),
          streamId,
          CHAT_STREAM_LOCK_TTL_SECONDS
        )
        if (acquired) {
          registerPendingChatStream(chatId, streamId)
          return true
        }
        if (!pendingChatStreams.has(chatId)) {
          const ownerStreamId = await redis.get(getChatStreamLockKey(chatId))
          if (ownerStreamId) {
            const settled = await waitForPendingChatStream(chatId, 0, ownerStreamId)
            if (settled) {
              continue
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to acquire chat stream lock', {
          chatId,
          streamId,
          error: toError(error).message,
        })
      }

      if (Date.now() >= deadline) {
        return false
      }
      await sleep(200)
    }
  }

  for (;;) {
    const existing = pendingChatStreams.get(chatId)
    if (!existing) {
      registerPendingChatStream(chatId, streamId)
      return true
    }

    const settled = await Promise.race([
      existing.promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
    if (!settled) {
      return false
    }
  }
}

/**
 * Returns `true` if it aborted an in-process controller,
 * `false` if it only wrote the marker (no local controller found).
 */
export async function abortActiveStream(streamId: string): Promise<boolean> {
  await writeAbortMarker(streamId)
  const controller = activeStreams.get(streamId)
  if (!controller) return false
  controller.abort('user_stop:abortActiveStream')
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
          abortController.abort('redis_abort_marker:poller')
          await clearAbortMarker(streamId)
        }
      } catch (error) {
        logger.warn('Failed to poll stream abort marker', {
          streamId,
          ...(requestId ? { requestId } : {}),
          error: toError(error).message,
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
      error: toError(error).message,
    })
  }
}
