import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getRedisClient } from '@/lib/core/config/redis'

/**
 * Which chat streams have a reconnected reader attached right now, on any instance.
 *
 * A chat view starts client-routed workflow tools from the stream it reads. The original send
 * knows in-process whether its own response is still attached; a view that re-attached through
 * the reconnect route (a reload, a chat switch back, another tab) may sit on another instance,
 * so each attachment holds its own entry here, scored by when it lapses, for as long as it
 * stays attached. Leaving removes the entry at once; a reader that dies without leaving lapses.
 */

const logger = createLogger('SessionStreamViewer')

/** Long enough that one late refresh never makes an attached reader look gone. */
const STREAM_VIEWER_TTL_MS = 10_000
const STREAM_VIEWER_REFRESH_MS = 3_000

function getViewersKey(streamId: string) {
  return `mothership_stream:${streamId}:viewers`
}

async function markStreamViewer(streamId: string, attachmentId: string): Promise<void> {
  const redis = getRedisClient()
  const key = getViewersKey(streamId)
  const now = Date.now()
  // Drops readers that died without leaving, which a live reader's refresh keeps the key past.
  await redis
    .multi()
    .zremrangebyscore(key, '-inf', now)
    .zadd(key, now + STREAM_VIEWER_TTL_MS, attachmentId)
    .pexpire(key, STREAM_VIEWER_TTL_MS)
    .exec()
}

async function unmarkStreamViewer(streamId: string, attachmentId: string): Promise<void> {
  await getRedisClient().zrem(getViewersKey(streamId), attachmentId)
}

function warnMarkFailed(streamId: string, error: unknown) {
  logger.warn('Could not record a chat stream reader', {
    streamId,
    error: toError(error).message,
  })
}

/**
 * Records a reader attached to the stream until the returned release runs. Resolves once the
 * first mark is written, so the reader counts before it reads its first event.
 */
export async function holdStreamViewer(streamId: string): Promise<() => void> {
  const attachmentId = generateId()
  const refresh = () =>
    markStreamViewer(streamId, attachmentId).catch((error) => warnMarkFailed(streamId, error))
  await refresh()
  const interval = setInterval(refresh, STREAM_VIEWER_REFRESH_MS)
  return () => {
    clearInterval(interval)
    unmarkStreamViewer(streamId, attachmentId).catch((error) => warnMarkFailed(streamId, error))
  }
}

/**
 * Whether a reconnected reader is attached to the stream. Answers true whenever it cannot
 * tell (a failed read), so an unknown never cuts a present view's pickup window.
 */
export async function hasStreamViewer(streamId: string): Promise<boolean> {
  try {
    return (await getRedisClient().zcount(getViewersKey(streamId), Date.now(), '+inf')) > 0
  } catch (error) {
    logger.warn('Could not read whether a chat stream reader is attached', {
      streamId,
      error: toError(error).message,
    })
    return true
  }
}
