import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import { readEvents } from '@/lib/mothership/request/session/buffer'
import { readFilePreviewSessions } from '@/lib/mothership/request/session/file-preview-session'
import { startsAtReplayHead } from '@/lib/mothership/request/session/recovery'
import { type StreamBatchEvent, toStreamBatchEvent } from '@/lib/mothership/request/session/types'

const logger = createLogger('LiveTurnSnapshot')

/** An in-flight turn's replay, for a chat load's first paint. */
export interface LiveTurnSnapshot {
  events: StreamBatchEvent[]
  previewSessions: FilePreviewSession[]
  status: string
}

/**
 * The in-flight turn of `streamId` as its replay ring holds it, or `null` once the ring
 * lost its head: a truncated turn is never painted, and the client re-syncs it through
 * the reconnect route instead.
 */
export async function readLiveTurnSnapshot(
  streamId: string,
  userId: string
): Promise<LiveTurnSnapshot | null> {
  const [events, previewSessions, run] = await Promise.all([
    readEvents(streamId, '0'),
    readFilePreviewSessions(streamId).catch((error) => {
      logger.warn('Failed to read preview sessions for a live turn', {
        streamId,
        error: toError(error).message,
      })
      return []
    }),
    getLatestRunForStream(streamId, userId).catch((error) => {
      logger.warn('Failed to read the latest run for a live turn', {
        streamId,
        error: toError(error).message,
      })
      return null
    }),
  ])
  if (!startsAtReplayHead(events[0]?.seq)) return null
  return {
    events: events.map(toStreamBatchEvent),
    previewSessions,
    status: typeof run?.status === 'string' ? run.status : events.length > 0 ? 'active' : 'unknown',
  }
}
