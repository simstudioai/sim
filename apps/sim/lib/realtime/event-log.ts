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
import { getConfiguredCacheProvider } from '@/lib/core/config/env-capabilities.server'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('EventLog')

/**
 * Atomic append: INCR the seq counter to mint a new eventId, splice it into the
 * adapter-supplied entry JSON, ZADD it, refresh TTLs, trim, and record the resulting
 * earliestEventId in meta — one round-trip. Without atomicity a slow reader could
 * observe the trim before the meta update and miss the prune signal.
 *
 * The buffer is bounded twice: to `cap` entries, and to `maxBytes`. The entry bound
 * alone bounds cardinality and says nothing about size — an entry here carries a
 * cell's outputs, which a dispatch resends cumulatively, so `cap` entries of a few
 * hundred KB is gigabytes for one table. Both trims drop the oldest, which is the
 * behaviour readers already handle: `earliestEventId` moves, `readEventsSince`
 * returns `pruned`, and the client refetches and resumes from latest.
 *
 * The running total is kept in meta rather than summed per append, and both keys
 * share a TTL so the counter cannot outlive the bytes it counts.
 *
 * KEYS: [events, seq, meta]
 * ARGV: [ttlSec, cap, updatedAtIso, entryPrefix, entrySuffix, maxBytes]
 *   The new eventId is spliced between prefix/suffix to form the entry JSON.
 * Returns the new eventId.
 */
const APPEND_EVENT_SCRIPT = `
local ttl_seconds = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local max_bytes = tonumber(ARGV[6])

local eventId = redis.call('INCR', KEYS[2])
local entry = ARGV[4] .. eventId .. ARGV[5]
redis.call('ZADD', KEYS[1], eventId, entry)
redis.call('EXPIRE', KEYS[1], ttl_seconds)
redis.call('EXPIRE', KEYS[2], ttl_seconds)

local total = tonumber(redis.call('HGET', KEYS[3], 'bytes') or '0') + string.len(entry)

local over = redis.call('ZCARD', KEYS[1]) - cap
if over > 0 then
  local dropped = redis.call('ZRANGE', KEYS[1], 0, over - 1)
  for _, member in ipairs(dropped) do
    total = total - string.len(member)
  end
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, over - 1)
end

while max_bytes > 0 and total > max_bytes and redis.call('ZCARD', KEYS[1]) > 1 do
  local oldest_member = redis.call('ZRANGE', KEYS[1], 0, 0)
  if not oldest_member[1] then break end
  total = total - string.len(oldest_member[1])
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, 0)
end
if total < 0 then total = 0 end
-- Self-correct: the counter is an accumulator, so an independently evicted events key would leave
-- it over-reporting forever and pin the buffer at a single entry. Whenever the buffer is down to one
-- entry its exact size is known, so drift cannot outlive a trim.
if redis.call('ZCARD', KEYS[1]) == 1 then
  local only = redis.call('ZRANGE', KEYS[1], 0, 0)
  if only[1] then total = string.len(only[1]) end
end

local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if oldest[2] then
  redis.call('HSET', KEYS[3], 'earliestEventId', tostring(math.floor(tonumber(oldest[2]))), 'bytes', tostring(total), 'updatedAt', ARGV[3])
  redis.call('EXPIRE', KEYS[3], ttl_seconds)
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
  /**
   * Byte ceiling for one stream's buffer. Entries are dropped oldest-first until the
   * buffer fits, exactly as `cap` does — an entry cap bounds how many entries a key
   * holds and nothing about how large each one is, which is how a key of a few
   * hundred entries reaches hundreds of megabytes.
   */
  maxBytes: number
  /** Max entries returned by one read; the SSE route drains in chunks. */
  readChunk: number
}

/** Minimal shape the core requires; adapters extend it with their own fields. */
export interface EventLogEntry {
  eventId: number
}

/**
 * How an adapter serializes one entry. `entryPrefix`/`entrySuffix` are spliced
 * around the minted `eventId` in Lua (`prefix + eventId + suffix`) for the Redis
 * write; `buildEntry` returns the equivalent object. It is the canonical entry
 * builder for BOTH paths — the in-memory fallback AND the Redis success path,
 * which returns `buildEntry(eventId)` rather than re-parsing the stored string —
 * so it MUST produce the byte-identical shape to the spliced JSON, or dev/no-Redis
 * behaves differently from prod.
 */
export interface EntrySerializer<E extends EventLogEntry> {
  entryPrefix: string
  entrySuffix: string
  buildEntry: (eventId: number) => E
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
  return typeof window === 'undefined' && getConfiguredCacheProvider() === 'database'
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
        const entry = serializer.buildEntry(stream.nextEventId++)
        stream.events.push(entry)
        if (stream.events.length > config.cap) {
          stream.events = stream.events.slice(-config.cap)
        }
        if (config.maxBytes > 0) {
          // UTF-8 bytes, so this path bounds a stream identically to the Lua's `string.len`;
          // `String.length` counts UTF-16 units and under-reports every non-ASCII event.
          const entryBytes = (event: EventLogEntry) =>
            Buffer.byteLength(JSON.stringify(event), 'utf8')
          let bytes = stream.events.reduce((total, event) => total + entryBytes(event), 0)
          while (bytes > config.maxBytes && stream.events.length > 1) {
            bytes -= entryBytes(stream.events[0])
            stream.events = stream.events.slice(1)
          }
        }
        stream.earliestEventId = stream.events[0]?.eventId
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
      serializer.entrySuffix,
      config.maxBytes
    )
    const eventId = typeof result === 'number' ? result : Number(result)
    if (!Number.isFinite(eventId)) return null
    return serializer.buildEntry(eventId)
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
