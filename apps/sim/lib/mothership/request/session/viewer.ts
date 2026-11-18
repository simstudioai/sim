import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

/**
 * Which chat streams have a reconnected reader attached right now, on any instance.
 *
 * A chat view starts client-routed workflow tools from the stream it reads. The original send
 * knows in-process whether its own response is still attached; a view that re-attached through
 * the reconnect route (a reload, a chat switch back, another tab) may sit on another instance,
 * so it marks itself here for as long as it stays attached.
 */

const logger = createLogger('SessionStreamViewer')

/** Long enough that one late refresh never makes an attached reader look gone. */
const STREAM_VIEWER_TTL_MS = 10_000
const STREAM_VIEWER_REFRESH_MS = 3_000

function getViewerKey(streamId: string) {
  return `mothership_stream:${streamId}:viewer`
}

async function markStreamViewer(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.set(getViewerKey(streamId), '1', 'PX', STREAM_VIEWER_TTL_MS)
}

/**
 * Marks a reader attached to the stream until the returned release runs. The mark lapses on
 * its own a few seconds after release, so a crashed reader never holds it.
 */
export function holdStreamViewer(streamId: string): () => void {
  const refresh = () => {
    markStreamViewer(streamId).catch((error) => {
      logger.warn('Could not mark a chat stream reader attached', {
        streamId,
        error: toError(error).message,
      })
    })
  }
  refresh()
  const interval = setInterval(refresh, STREAM_VIEWER_REFRESH_MS)
  return () => clearInterval(interval)
}

/**
 * Whether a reconnected reader is attached to the stream. Answers true whenever it cannot
 * tell (no Redis, a failed read), so an unknown never cuts a present view's pickup window.
 */
export async function hasStreamViewer(streamId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return true
  try {
    return (await redis.exists(getViewerKey(streamId))) > 0
  } catch (error) {
    logger.warn('Could not read whether a chat stream reader is attached', {
      streamId,
      error: toError(error).message,
    })
    return true
  }
}
