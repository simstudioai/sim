import { createLogger } from '@sim/logger'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import { acquireLock, getRedisClient, releaseLock } from '@/lib/core/config/redis'
import { clearAbortMarker, hasAbortMarker, writeAbortMarker } from './buffer'
import { AbortBackend } from '@/lib/copilot/generated/trace-attribute-values-v1'

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
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } else if (!localPending) {
      return true
    }

    if (Date.now() >= deadline) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
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
      error: error instanceof Error ? error.message : String(error),
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
      error: error instanceof Error ? error.message : String(error),
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
  // Span records wall time spent waiting for the per-chat stream lock.
  // Typical case: sub-10ms uncontested acquire. Worst case: up to
  // `timeoutMs` spent polling while a prior stream finishes. Previously
  // this time looked like "unexplained gap before llm.stream".
  return withCopilotSpan(
    TraceSpan.CopilotChatAcquirePendingStreamLock,
    {
      'chat.id': chatId,
      'stream.id': streamId,
      'lock.timeout_ms': timeoutMs,
    },
    async (span) => {
      const redis = getRedisClient()
      span.setAttribute(
        TraceAttr.LockBackend,
        redis ? AbortBackend.Redis : AbortBackend.InProcess
      )
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
              span.setAttribute(TraceAttr.LockAcquired, true)
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
              error: error instanceof Error ? error.message : String(error),
            })
          }

          if (Date.now() >= deadline) {
            span.setAttribute(TraceAttr.LockAcquired, false)
            span.setAttribute(TraceAttr.LockTimedOut, true)
            return false
          }
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }

      for (;;) {
        const existing = pendingChatStreams.get(chatId)
        if (!existing) {
          registerPendingChatStream(chatId, streamId)
          span.setAttribute(TraceAttr.LockAcquired, true)
          return true
        }

        const settled = await Promise.race([
          existing.promise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ])
        if (!settled) {
          span.setAttribute(TraceAttr.LockAcquired, false)
          span.setAttribute(TraceAttr.LockTimedOut, true)
          return false
        }
      }
    }
  )
}

/**
 * Returns `true` if it aborted an in-process controller,
 * `false` if it only wrote the marker (no local controller found).
 *
 * Spanned because the two operations inside can stall independently
 * — Redis latency on `writeAbortMarker` was previously invisible, and
 * the "no local controller" branch (happens when the stream handler
 * is on a different Sim box than the one receiving /chat/abort) is
 * a subtle but important outcome to distinguish from "aborted a live
 * controller" in dashboards.
 */
export async function abortActiveStream(streamId: string): Promise<boolean> {
  return withCopilotSpan(
    TraceSpan.CopilotChatAbortActiveStream,
    { [TraceAttr.StreamId]: streamId },
    async (span) => {
      await writeAbortMarker(streamId)
      span.setAttribute(TraceAttr.CopilotAbortMarkerWritten, true)
      const controller = activeStreams.get(streamId)
      if (!controller) {
        span.setAttribute(TraceAttr.CopilotAbortControllerFired, false)
        return false
      }
      controller.abort(AbortReason.UserStop)
      activeStreams.delete(streamId)
      span.setAttribute(TraceAttr.CopilotAbortControllerFired, true)
      return true
    }
  )
}

/**
 * Reason strings passed to `AbortController.abort(reason)` for every
 * Sim-originated cancel path. Exported so the lifecycle finalizer can
 * look at `signal.reason` and distinguish EXPLICIT stops (user hit the
 * Stop button) from client disconnects (tab closed, network dropped)
 * without guessing.
 *
 * Why this matters: when the user clicks Stop, we fire
 * `abortController.abort(AbortReason.UserStop)` from
 * `abortActiveStream()`. That causes Sim's SSE writer to close, which
 * in turn makes the BROWSER's SSE reader see the stream end — which
 * fires the browser-side fetch AbortController and propagates back to
 * Sim as `publisher.markDisconnected()`. So on an explicit Stop you
 * observe BOTH "explicit reason" AND "client disconnected" — the
 * discriminator is the reason string, not the client flag.
 *
 * For any NEW abort path, add its reason here and in the
 * `isExplicitStopReason` helper so classification stays correct.
 */
export const AbortReason = {
  /** Same-process stop: browser→Sim→abortActiveStream. */
  UserStop: 'user_stop:abortActiveStream',
  /**
   * Cross-process stop: the SIM node that held the SSE didn't receive
   * the Stop HTTP call, but it polled the Redis abort marker that the
   * node that DID receive it wrote, and aborts on the poll.
   */
  RedisPoller: 'redis_abort_marker:poller',
  /** Internal timeout on the outbound explicit-abort fetch to Go. */
  ExplicitAbortFetchTimeout: 'timeout:go_explicit_abort_fetch',
} as const

export type AbortReasonValue = (typeof AbortReason)[keyof typeof AbortReason]

/**
 * True iff `reason` indicates the user explicitly triggered the abort
 * (as opposed to an implicit client disconnect or server timeout).
 * Treated as a small closed vocabulary — any string not in
 * `AbortReason` is presumed non-explicit.
 */
export function isExplicitStopReason(reason: unknown): boolean {
  return (
    reason === AbortReason.UserStop || reason === AbortReason.RedisPoller
  )
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
          abortController.abort(AbortReason.RedisPoller)
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
