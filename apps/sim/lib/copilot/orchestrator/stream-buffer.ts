import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotStreamBuffer')

const STREAM_TTL_SECONDS = 60 * 60
const STREAM_EVENT_LIMIT = 5000
const STREAM_RESERVE_BATCH = 200
const STREAM_FLUSH_INTERVAL_MS = 15
const STREAM_FLUSH_MAX_BATCH = 200

const APPEND_STREAM_EVENT_LUA = `
local seqKey = KEYS[1]
local eventsKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local streamId = ARGV[3]
local eventJson = ARGV[4]

local id = redis.call('INCR', seqKey)
local entry = '{"eventId":' .. id .. ',"streamId":' .. cjson.encode(streamId) .. ',"event":' .. eventJson .. '}'
redis.call('ZADD', eventsKey, id, entry)
redis.call('EXPIRE', eventsKey, ttl)
redis.call('EXPIRE', seqKey, ttl)
if limit > 0 then
  redis.call('ZREMRANGEBYRANK', eventsKey, 0, -limit-1)
end
return id
`

function getStreamKeyPrefix(streamId: string) {
  return `copilot_stream:${streamId}`
}

function getEventsKey(streamId: string) {
  return `${getStreamKeyPrefix(streamId)}:events`
}

function getSeqKey(streamId: string) {
  return `${getStreamKeyPrefix(streamId)}:seq`
}

function getMetaKey(streamId: string) {
  return `${getStreamKeyPrefix(streamId)}:meta`
}

export type StreamStatus = 'active' | 'complete' | 'error'

export type StreamMeta = {
  status: StreamStatus
  userId?: string
  updatedAt?: string
  error?: string
}

export type StreamEventEntry = {
  eventId: number
  streamId: string
  event: Record<string, any>
}

export type StreamEventWriter = {
  write: (event: Record<string, any>) => Promise<StreamEventEntry>
  flush: () => Promise<void>
  close: () => Promise<void>
}

export async function resetStreamBuffer(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.del(getEventsKey(streamId), getSeqKey(streamId), getMetaKey(streamId))
  } catch (error) {
    logger.warn('Failed to reset stream buffer', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function setStreamMeta(
  streamId: string,
  meta: StreamMeta
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    const payload: Record<string, string> = {
      status: meta.status,
      updatedAt: meta.updatedAt || new Date().toISOString(),
    }
    if (meta.userId) payload.userId = meta.userId
    if (meta.error) payload.error = meta.error
    await redis.hset(getMetaKey(streamId), payload)
    await redis.expire(getMetaKey(streamId), STREAM_TTL_SECONDS)
  } catch (error) {
    logger.warn('Failed to update stream meta', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getStreamMeta(streamId: string): Promise<StreamMeta | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const meta = await redis.hgetall(getMetaKey(streamId))
    if (!meta || Object.keys(meta).length === 0) return null
    return meta as StreamMeta
  } catch (error) {
    logger.warn('Failed to read stream meta', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function appendStreamEvent(
  streamId: string,
  event: Record<string, any>
): Promise<StreamEventEntry> {
  const redis = getRedisClient()
  if (!redis) {
    return { eventId: 0, streamId, event }
  }

  try {
    const eventJson = JSON.stringify(event)
    const nextId = await redis.eval(
      APPEND_STREAM_EVENT_LUA,
      2,
      getSeqKey(streamId),
      getEventsKey(streamId),
      STREAM_TTL_SECONDS,
      STREAM_EVENT_LIMIT,
      streamId,
      eventJson
    )
    const eventId = typeof nextId === 'number' ? nextId : Number(nextId)
    return { eventId, streamId, event }
  } catch (error) {
    logger.warn('Failed to append stream event', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { eventId: 0, streamId, event }
  }
}

export function createStreamEventWriter(streamId: string): StreamEventWriter {
  const redis = getRedisClient()
  if (!redis) {
    return {
      write: async (event) => ({ eventId: 0, streamId, event }),
      flush: async () => {},
      close: async () => {},
    }
  }

  let pending: StreamEventEntry[] = []
  let nextEventId = 0
  let maxReservedId = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let isFlushing = false

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, STREAM_FLUSH_INTERVAL_MS)
  }

  const reserveIds = async (minCount: number) => {
    const reserveCount = Math.max(STREAM_RESERVE_BATCH, minCount)
    const newMax = await redis.incrby(getSeqKey(streamId), reserveCount)
    const startId = newMax - reserveCount + 1
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      nextEventId = startId
      maxReservedId = newMax
    }
  }

  const flush = async () => {
    if (isFlushing || pending.length === 0) return
    isFlushing = true
    const batch = pending
    pending = []
    try {
      const key = getEventsKey(streamId)
      const zaddArgs: (string | number)[] = []
      for (const entry of batch) {
        zaddArgs.push(entry.eventId, JSON.stringify(entry))
      }
      const pipeline = redis.pipeline()
      pipeline.zadd(key, ...(zaddArgs as any))
      pipeline.expire(key, STREAM_TTL_SECONDS)
      pipeline.expire(getSeqKey(streamId), STREAM_TTL_SECONDS)
      pipeline.zremrangebyrank(key, 0, -STREAM_EVENT_LIMIT - 1)
      await pipeline.exec()
    } catch (error) {
      logger.warn('Failed to flush stream events', {
        streamId,
        error: error instanceof Error ? error.message : String(error),
      })
      pending = batch.concat(pending)
    } finally {
      isFlushing = false
      if (pending.length > 0) scheduleFlush()
    }
  }

  const write = async (event: Record<string, any>) => {
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      await reserveIds(1)
    }
    const eventId = nextEventId++
    const entry: StreamEventEntry = { eventId, streamId, event }
    pending.push(entry)
    if (pending.length >= STREAM_FLUSH_MAX_BATCH) {
      await flush()
    } else {
      scheduleFlush()
    }
    return entry
  }

  const close = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    await flush()
  }

  return { write, flush, close }
}

export async function readStreamEvents(
  streamId: string,
  afterEventId: number
): Promise<StreamEventEntry[]> {
  const redis = getRedisClient()
  if (!redis) return []
  try {
    const raw = await redis.zrangebyscore(getEventsKey(streamId), afterEventId + 1, '+inf')
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as StreamEventEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is StreamEventEntry => Boolean(entry))
  } catch (error) {
    logger.warn('Failed to read stream events', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

