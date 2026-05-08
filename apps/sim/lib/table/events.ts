/**
 * Per-table event buffer for live cell-state updates.
 *
 * The grid subscribes to a per-table SSE stream and patches its React Query
 * cache as events arrive. This buffer is the durable mid-tier between the
 * cell-write paths (`writeWorkflowGroupState`, `cancelWorkflowGroupRuns`) and
 * the SSE consumers — every status transition appends here with a monotonic
 * eventId; SSE clients resume on reconnect via `?from=<lastEventId>` and the
 * server replays from this buffer.
 *
 * Modeled after `apps/sim/lib/execution/event-buffer.ts` but stripped of
 * complexity tables don't need: no per-execution lifecycle, no id reservation
 * batching, no write-queue serialization. Tables are always-on; cell writes
 * are sparse and independent.
 */

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('TableEventBuffer')

const REDIS_PREFIX = 'table:stream:'
export const TABLE_EVENT_TTL_SECONDS = 60 * 60 // 1 hour
export const TABLE_EVENT_CAP = 5000
/** Max events returned by a single read; the SSE route drains in chunks. */
export const TABLE_EVENT_READ_CHUNK = 500

/**
 * Atomic append: INCR the seq counter to mint a new eventId, build the entry
 * JSON inline, ZADD it, refresh TTL on events + seq + meta, trim to cap, then
 * write the resulting earliestEventId to meta. Single round-trip per event.
 * Without atomicity a slow reader could observe the trim before the meta
 * update and miss the prune signal.
 *
 * KEYS: [events, seq, meta]
 * ARGV: [ttlSec, cap, updatedAtIso, entryPrefix, entrySuffix]
 *   The new eventId is spliced between prefix/suffix to form the entry JSON.
 *   Returns the new eventId.
 */
const APPEND_EVENT_SCRIPT = `
local eventId = redis.call('INCR', KEYS[2])
local entry = ARGV[4] .. eventId .. ARGV[5]
redis.call('ZADD', KEYS[1], eventId, entry)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[2]) - 1)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if oldest[2] then
  redis.call('HSET', KEYS[3], 'earliestEventId', tostring(math.floor(tonumber(oldest[2]))), 'updatedAt', ARGV[3])
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[1]))
end
return eventId
`

function getEventsKey(tableId: string) {
  return `${REDIS_PREFIX}${tableId}:events`
}

function getSeqKey(tableId: string) {
  return `${REDIS_PREFIX}${tableId}:seq`
}

function getMetaKey(tableId: string) {
  return `${REDIS_PREFIX}${tableId}:meta`
}

export type TableCellStatus = 'pending' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'

export interface TableEvent {
  kind: 'cell'
  tableId: string
  rowId: string
  groupId: string
  status: TableCellStatus
  executionId: string | null
  jobId: string | null
  error: string | null
  /**
   * Present when this transition wrote new output values; absent on
   * pure-status transitions (queued, running, cancelled). The publisher
   * already has these in hand from the same updateRow call that wrote DB.
   */
  outputs?: Record<string, unknown>
  /**
   * Block-level metadata the renderer reads to distinguish "running" (some
   * block actively executing) from "pending-upstream" (run started but this
   * column's block hasn't fired yet). The worker fills these on partial
   * writes; without them the cell stays on the amber Pending pill.
   */
  runningBlockIds?: string[]
  blockErrors?: Record<string, string>
}

export interface TableEventEntry {
  eventId: number
  tableId: string
  event: TableEvent
}

export type TableEventsReadResult =
  | { status: 'ok'; events: TableEventEntry[] }
  | { status: 'pruned'; earliestEventId: number | undefined }
  | { status: 'unavailable'; error: string }

/** In-memory fallback for dev/tests when Redis isn't configured. */
interface MemoryTableStream {
  events: TableEventEntry[]
  earliestEventId?: number
  nextEventId: number
  expiresAt: number
}

const memoryTableStreams = new Map<string, MemoryTableStream>()

function canUseMemoryBuffer(): boolean {
  return typeof window === 'undefined' && !env.REDIS_URL
}

function pruneExpiredMemoryStreams(now = Date.now()): void {
  for (const [tableId, stream] of memoryTableStreams) {
    if (stream.expiresAt <= now) {
      memoryTableStreams.delete(tableId)
    }
  }
}

function getMemoryStream(tableId: string): MemoryTableStream {
  pruneExpiredMemoryStreams()
  let stream = memoryTableStreams.get(tableId)
  if (!stream) {
    stream = {
      events: [],
      nextEventId: 1,
      expiresAt: Date.now() + TABLE_EVENT_TTL_SECONDS * 1000,
    }
    memoryTableStreams.set(tableId, stream)
  }
  return stream
}

function appendMemory(event: TableEvent): TableEventEntry {
  const stream = getMemoryStream(event.tableId)
  const entry: TableEventEntry = {
    eventId: stream.nextEventId++,
    tableId: event.tableId,
    event,
  }
  stream.events.push(entry)
  if (stream.events.length > TABLE_EVENT_CAP) {
    stream.events = stream.events.slice(-TABLE_EVENT_CAP)
    stream.earliestEventId = stream.events[0]?.eventId
  }
  stream.expiresAt = Date.now() + TABLE_EVENT_TTL_SECONDS * 1000
  return entry
}

function readMemory(tableId: string, afterEventId: number): TableEventsReadResult {
  pruneExpiredMemoryStreams()
  const stream = memoryTableStreams.get(tableId)
  if (!stream) {
    // Mirror the Redis path: a non-zero afterEventId with no buffer at all
    // means TTL expired or the stream never existed; either way the caller's
    // cursor is stale.
    if (afterEventId > 0) return { status: 'pruned', earliestEventId: undefined }
    return { status: 'ok', events: [] }
  }
  if (stream.earliestEventId !== undefined && afterEventId + 1 < stream.earliestEventId) {
    return { status: 'pruned', earliestEventId: stream.earliestEventId }
  }
  return {
    status: 'ok',
    events: stream.events
      .filter((entry) => entry.eventId > afterEventId)
      .slice(0, TABLE_EVENT_READ_CHUNK),
  }
}

/**
 * Append an event to the table's buffer. Fire-and-forget from the caller —
 * this never throws, returns null on failure. A Redis blip must not fail a
 * cell-write.
 */
export async function appendTableEvent(event: TableEvent): Promise<TableEventEntry | null> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryBuffer()) {
      try {
        return appendMemory(event)
      } catch (error) {
        logger.warn('appendTableEvent: memory append failed', {
          tableId: event.tableId,
          error: toError(error).message,
        })
        return null
      }
    }
    return null
  }
  try {
    // Build the entry JSON in two halves so Lua can splice the new eventId
    // between them without us needing a round-trip just to mint the id first.
    const tail = `,"tableId":${JSON.stringify(event.tableId)},"event":${JSON.stringify(event)}}`
    const head = `{"eventId":`
    const result = await redis.eval(
      APPEND_EVENT_SCRIPT,
      3,
      getEventsKey(event.tableId),
      getSeqKey(event.tableId),
      getMetaKey(event.tableId),
      TABLE_EVENT_TTL_SECONDS,
      TABLE_EVENT_CAP,
      new Date().toISOString(),
      head,
      tail
    )
    const eventId = typeof result === 'number' ? result : Number(result)
    if (!Number.isFinite(eventId)) return null
    return { eventId, tableId: event.tableId, event }
  } catch (error) {
    logger.warn('appendTableEvent: Redis append failed', {
      tableId: event.tableId,
      error: toError(error).message,
    })
    return null
  }
}

/**
 * Read events for a table where eventId > afterEventId. Returns 'pruned' if
 * the caller has fallen off the back of the buffer (TTL expired or cap rolled
 * past their lastEventId). Caller should respond by full-refetching from DB
 * and resuming streaming from the new earliestEventId.
 */
export async function readTableEventsSince(
  tableId: string,
  afterEventId: number
): Promise<TableEventsReadResult> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryBuffer()) {
      return readMemory(tableId, afterEventId)
    }
    return { status: 'unavailable', error: 'Redis client unavailable' }
  }
  try {
    const meta = await redis.hgetall(getMetaKey(tableId))
    const earliestEventId =
      meta?.earliestEventId !== undefined ? Number(meta.earliestEventId) : undefined
    if (earliestEventId !== undefined && afterEventId + 1 < earliestEventId) {
      return { status: 'pruned', earliestEventId }
    }
    // Read in capped chunks so a 5000-event backlog doesn't materialize as one
    // multi-MB Redis reply + JSON parse + SSE flush. The route loop drains
    // chunks across ticks.
    const raw = await redis.zrangebyscore(
      getEventsKey(tableId),
      afterEventId + 1,
      '+inf',
      'LIMIT',
      0,
      TABLE_EVENT_READ_CHUNK
    )
    if (raw.length === 0 && afterEventId > 0) {
      // Total TTL expiry: events + meta both gone. The seq counter has the
      // same TTL — its absence means the buffer was wiped and the caller's
      // `afterEventId` is stale. Signal pruned so the client refetches.
      const seqExists = await redis.exists(getSeqKey(tableId))
      if (seqExists === 0) {
        return { status: 'pruned', earliestEventId: undefined }
      }
    }
    return {
      status: 'ok',
      events: raw
        .map((entry) => {
          try {
            return JSON.parse(entry) as TableEventEntry
          } catch {
            return null
          }
        })
        .filter((entry): entry is TableEventEntry => Boolean(entry)),
    }
  } catch (error) {
    const message = toError(error).message
    logger.warn('readTableEventsSince failed', { tableId, error: message })
    return { status: 'unavailable', error: message }
  }
}
