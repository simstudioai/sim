/**
 * Generic durable event log over Redis (sorted set + monotonic id + TTL), with an
 * in-memory fallback for dev/tests. This is the reusable core extracted from the
 * Tables cell-event buffer; a domain adapter (e.g. `lib/table/events.ts`) supplies
 * its Redis key prefix and how to serialize an entry, and gets append/read/tail
 * semantics for free — including replay-on-reconnect and prune detection.
 *
 * The core is deliberately domain-neutral: it only knows an entry has a numeric
 * `eventId`. Everything else in the entry is opaque bytes the adapter owns, so a
 * domain can keep its exact wire shape (and its existing Redis keys) unchanged.
 *
 * Modeled after `apps/sim/lib/execution/event-buffer.ts` but stripped of what an
 * always-on stream doesn't need (no id-reservation batching, no write-queue
 * serialization, no per-entity terminal lifecycle, no byte budgeting).
 */

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('EventLog')

/**
 * Atomic append: INCR the seq counter to mint a new eventId, splice it into the
 * adapter-supplied entry JSON, ZADD it, refresh TTLs, trim to cap, and record the
 * resulting earliestEventId in meta — one round-trip. Without atomicity a slow
 * reader could observe the trim before the meta update and miss the prune signal.
 *
 * KEYS: [events, seq, meta]
 * ARGV: [ttlSec, cap, updatedAtIso, entryPrefix, entrySuffix]
 *   The new eventId is spliced between prefix/suffix to form the entry JSON.
 * Returns the new eventId.
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

/** Configuration for a durable event-log stream family (e.g. Tables). */
export interface EventLogConfig {
  /**
   * Redis key prefix, e.g. `table:stream:`. STABLE per family — renaming it resets
   * the seq counter, which silently strands live clients holding a higher
   * in-memory `lastEventId` (their `?from=` never matches). Never change it.
   */
  prefix: string
  ttlSeconds: number
  cap: number
  /** Max entries returned by one read; the SSE route drains in chunks. */
  readChunk: number
}

/** Minimal shape the core requires; adapters extend it with their own fields. */
export interface EventLogEntry {
  eventId: number
}

/**
 * How an adapter serializes one entry. `entryPrefix`/`entrySuffix` are spliced
 * around the minted `eventId` in Lua (`prefix + eventId + suffix`); `buildMemory`
 * must produce the byte-identical object for the in-memory fallback. The two MUST
 * agree — a divergence makes dev/no-Redis behave differently from prod.
 */
export interface EntrySerializer<E extends EventLogEntry> {
  entryPrefix: string
  entrySuffix: string
  buildMemory: (eventId: number) => E
}

export type EventLogReadResult<E extends EventLogEntry> =
  | { status: 'ok'; events: E[] }
  | { status: 'pruned'; earliestEventId: number | undefined }
  | { status: 'unavailable'; error: string }

function eventsKey(config: EventLogConfig, streamId: string) {
  return `${config.prefix}${streamId}:events`
}
function seqKey(config: EventLogConfig, streamId: string) {
  return `${config.prefix}${streamId}:seq`
}
function metaKey(config: EventLogConfig, streamId: string) {
  return `${config.prefix}${streamId}:meta`
}

interface MemoryStream<E extends EventLogEntry> {
  events: E[]
  earliestEventId?: number
  nextEventId: number
  expiresAt: number
}

/** In-memory fallback keyed by `${prefix}${streamId}`, shared across all families. */
const memoryStreams = new Map<string, MemoryStream<EventLogEntry>>()

function memoryKey(config: EventLogConfig, streamId: string) {
  return `${config.prefix}${streamId}`
}

function canUseMemoryBuffer(): boolean {
  return typeof window === 'undefined' && !env.REDIS_URL
}

function pruneExpiredMemoryStreams(now = Date.now()): void {
  for (const [key, stream] of memoryStreams) {
    if (stream.expiresAt <= now) memoryStreams.delete(key)
  }
}

function getMemoryStream(config: EventLogConfig, streamId: string): MemoryStream<EventLogEntry> {
  pruneExpiredMemoryStreams()
  const key = memoryKey(config, streamId)
  let stream = memoryStreams.get(key)
  if (!stream) {
    stream = { events: [], nextEventId: 1, expiresAt: Date.now() + config.ttlSeconds * 1000 }
    memoryStreams.set(key, stream)
  }
  return stream
}

/**
 * Append an event. Fire-and-forget from the caller — never throws, returns null on
 * failure. A Redis blip must not fail the originating mutation.
 */
export async function appendEvent<E extends EventLogEntry>(
  config: EventLogConfig,
  streamId: string,
  serializer: EntrySerializer<E>
): Promise<E | null> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryBuffer()) {
      try {
        const stream = getMemoryStream(config, streamId)
        const entry = serializer.buildMemory(stream.nextEventId++)
        stream.events.push(entry)
        if (stream.events.length > config.cap) {
          stream.events = stream.events.slice(-config.cap)
          stream.earliestEventId = stream.events[0]?.eventId
        }
        stream.expiresAt = Date.now() + config.ttlSeconds * 1000
        return entry
      } catch (error) {
        logger.warn('appendEvent: memory append failed', {
          streamId,
          error: toError(error).message,
        })
        return null
      }
    }
    return null
  }
  try {
    const result = await redis.eval(
      APPEND_EVENT_SCRIPT,
      3,
      eventsKey(config, streamId),
      seqKey(config, streamId),
      metaKey(config, streamId),
      config.ttlSeconds,
      config.cap,
      new Date().toISOString(),
      serializer.entryPrefix,
      serializer.entrySuffix
    )
    const eventId = typeof result === 'number' ? result : Number(result)
    if (!Number.isFinite(eventId)) return null
    return serializer.buildMemory(eventId)
  } catch (error) {
    logger.warn('appendEvent: Redis append failed', { streamId, error: toError(error).message })
    return null
  }
}

/**
 * The latest eventId assigned for a stream, or 0 when empty/expired. Used by the
 * stream route to tail from "now" when a client connects without a replay cursor.
 * Redis errors propagate so the route errors the stream instead of replaying the
 * whole buffer over freshly-fetched state.
 */
export async function getLatestEventId(config: EventLogConfig, streamId: string): Promise<number> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryBuffer()) {
      const stream = memoryStreams.get(memoryKey(config, streamId))
      return stream ? stream.nextEventId - 1 : 0
    }
    return 0
  }
  const raw = await redis.get(seqKey(config, streamId))
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Read events where eventId > afterEventId. Returns 'pruned' if the caller has
 * fallen off the back of the buffer (TTL expired or cap rolled past their cursor);
 * the caller should full-refetch and resume from the new earliest id.
 */
export async function readEventsSince<E extends EventLogEntry>(
  config: EventLogConfig,
  streamId: string,
  afterEventId: number
): Promise<EventLogReadResult<E>> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryBuffer()) {
      pruneExpiredMemoryStreams()
      const stream = memoryStreams.get(memoryKey(config, streamId))
      if (!stream) {
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
          .slice(0, config.readChunk) as E[],
      }
    }
    return { status: 'unavailable', error: 'Redis client unavailable' }
  }
  try {
    const meta = await redis.hgetall(metaKey(config, streamId))
    const earliestEventId =
      meta?.earliestEventId !== undefined ? Number(meta.earliestEventId) : undefined
    if (earliestEventId !== undefined && afterEventId + 1 < earliestEventId) {
      return { status: 'pruned', earliestEventId }
    }
    const raw = await redis.zrangebyscore(
      eventsKey(config, streamId),
      afterEventId + 1,
      '+inf',
      'LIMIT',
      0,
      config.readChunk
    )
    if (raw.length === 0 && afterEventId > 0) {
      const seqExists = await redis.exists(seqKey(config, streamId))
      if (seqExists === 0) {
        return { status: 'pruned', earliestEventId: undefined }
      }
    }
    return {
      status: 'ok',
      events: raw
        .map((entry) => {
          try {
            return JSON.parse(entry) as E
          } catch {
            return null
          }
        })
        .filter((entry): entry is E => entry !== null),
    }
  } catch (error) {
    const message = toError(error).message
    logger.warn('readEventsSince failed', { streamId, error: message })
    return { status: 'unavailable', error: message }
  }
}

/** Test-only: clear the in-memory streams between cases. */
export function resetEventLogMemoryForTesting(): void {
  memoryStreams.clear()
}
