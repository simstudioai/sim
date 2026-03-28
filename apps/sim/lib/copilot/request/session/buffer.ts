import { createLogger } from '@sim/logger'
import type { MothershipStreamV1EventEnvelope } from '@/lib/copilot/generated/mothership-stream-v1'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('SessionBuffer')

const STREAM_OUTBOX_PREFIX = 'mothership_stream:'
const DEFAULT_TTL_SECONDS = 60 * 60
const DEFAULT_EVENT_LIMIT = 5_000
const RETRY_DELAYS_MS = [0, 50, 150] as const

type RedisOperationMetadata = {
  operation: string
  streamId: string
}

function getEventsKey(streamId: string) {
  return `${STREAM_OUTBOX_PREFIX}${streamId}:events`
}

function getSeqKey(streamId: string) {
  return `${STREAM_OUTBOX_PREFIX}${streamId}:seq`
}

function getAbortKey(streamId: string) {
  return `${STREAM_OUTBOX_PREFIX}${streamId}:abort`
}

export type StreamConfig = {
  ttlSeconds: number
  eventLimit: number
}

export function getStreamConfig(): StreamConfig {
  return {
    ttlSeconds: parsePositiveNumber(env.COPILOT_STREAM_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    eventLimit: parsePositiveNumber(env.COPILOT_STREAM_EVENT_LIMIT, DEFAULT_EVENT_LIMIT),
  }
}

function parsePositiveNumber(value: number | string | undefined, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function withRedisRetry<T>(
  metadata: RedisOperationMetadata,
  operation: (redis: NonNullable<ReturnType<typeof getRedisClient>>) => Promise<T>
): Promise<T> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis is required for mothership stream durability')
  }

  let lastError: unknown

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    try {
      return await operation(redis)
    } catch (error) {
      lastError = error
      logger.warn('Redis stream operation failed', {
        operation: metadata.operation,
        streamId: metadata.streamId,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${metadata.operation} failed for stream ${metadata.streamId}`)
}

export async function allocateCursor(streamId: string): Promise<{
  seq: number
  cursor: string
}> {
  const config = getStreamConfig()
  const seq = await withRedisRetry({ operation: 'allocate_cursor', streamId }, async (redis) => {
    const nextValue = await redis.incr(getSeqKey(streamId))
    await redis.expire(getSeqKey(streamId), config.ttlSeconds)
    return typeof nextValue === 'number' ? nextValue : Number(nextValue)
  })

  return { seq, cursor: String(seq) }
}

export async function resetBuffer(streamId: string): Promise<void> {
  await withRedisRetry({ operation: 'reset_outbox', streamId }, async (redis) => {
    await redis.del(getEventsKey(streamId), getSeqKey(streamId), getAbortKey(streamId))
  })
}

export async function appendEvents(
  envelopes: MothershipStreamV1EventEnvelope[]
): Promise<MothershipStreamV1EventEnvelope[]> {
  if (envelopes.length === 0) {
    return envelopes
  }

  const streamId = envelopes[0].stream.streamId
  const config = getStreamConfig()

  await withRedisRetry({ operation: 'append_event', streamId }, async (redis) => {
    const key = getEventsKey(streamId)
    const seqKey = getSeqKey(streamId)
    const pipeline = redis.pipeline()
    const zaddArgs: Array<number | string> = []
    for (const envelope of envelopes) {
      zaddArgs.push(envelope.seq, JSON.stringify(envelope))
    }
    pipeline.zadd(key, ...(zaddArgs as [number, string, ...Array<number | string>]))
    pipeline.expire(key, config.ttlSeconds)
    pipeline.set(seqKey, String(envelopes[envelopes.length - 1].seq), 'EX', config.ttlSeconds)
    if (config.eventLimit > 0) {
      pipeline.zremrangebyrank(key, 0, -config.eventLimit - 1)
    }
    await pipeline.exec()
  })

  return envelopes
}

export async function appendEvent(
  envelope: MothershipStreamV1EventEnvelope
): Promise<MothershipStreamV1EventEnvelope> {
  await appendEvents([envelope])
  return envelope
}

export class InvalidCursorError extends Error {
  constructor(
    public readonly streamId: string,
    public readonly cursor: string
  ) {
    super(`Invalid non-numeric cursor "${cursor}" for stream ${streamId}`)
    this.name = 'InvalidCursorError'
  }
}

export async function readEvents(
  streamId: string,
  afterCursor: string
): Promise<MothershipStreamV1EventEnvelope[]> {
  const afterSeq = Number(afterCursor || '0')
  if (!Number.isFinite(afterSeq)) {
    throw new InvalidCursorError(streamId, afterCursor)
  }
  const minScore = afterSeq + 1

  const rawEntries = await withRedisRetry({ operation: 'read_events', streamId }, async (redis) => {
    return redis.zrangebyscore(getEventsKey(streamId), minScore, '+inf')
  })

  const envelopes: MothershipStreamV1EventEnvelope[] = []
  for (const entry of rawEntries) {
    try {
      const parsed = JSON.parse(entry) as MothershipStreamV1EventEnvelope
      if (!parsed?.stream?.streamId || typeof parsed.seq !== 'number') {
        logger.warn('Skipping corrupt outbox entry: missing required fields', { streamId })
        continue
      }
      envelopes.push(parsed)
    } catch (error) {
      logger.warn('Skipping corrupt outbox entry: JSON parse failed', {
        streamId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return envelopes
}

export async function getOldestSeq(streamId: string): Promise<number | null> {
  return withRedisRetry({ operation: 'get_oldest_seq', streamId }, async (redis) => {
    const entries = await redis.zrangebyscore(getEventsKey(streamId), '-inf', '+inf', 'LIMIT', 0, 1)
    if (!entries || entries.length === 0) {
      return null
    }
    try {
      const parsed = JSON.parse(entries[0]) as { seq?: number }
      return typeof parsed.seq === 'number' ? parsed.seq : null
    } catch {
      logger.warn('Failed to parse oldest outbox entry', { streamId })
      return null
    }
  })
}

export async function getLatestSeq(streamId: string): Promise<number | null> {
  return withRedisRetry({ operation: 'get_latest_seq', streamId }, async (redis) => {
    const currentSeq = await redis.get(getSeqKey(streamId))
    if (currentSeq === null) {
      return null
    }
    const parsed = Number(currentSeq)
    return Number.isFinite(parsed) ? parsed : null
  })
}

export async function writeAbortMarker(streamId: string): Promise<void> {
  const ttlSeconds = getStreamConfig().ttlSeconds
  await withRedisRetry({ operation: 'write_abort_marker', streamId }, async (redis) => {
    await redis.set(getAbortKey(streamId), '1', 'EX', ttlSeconds)
  })
}

export async function hasAbortMarker(streamId: string): Promise<boolean> {
  return withRedisRetry({ operation: 'read_abort_marker', streamId }, async (redis) => {
    const marker = await redis.get(getAbortKey(streamId))
    return marker === '1'
  })
}

export async function clearAbortMarker(streamId: string): Promise<void> {
  await withRedisRetry({ operation: 'clear_abort_marker', streamId }, async (redis) => {
    await redis.del(getAbortKey(streamId))
  })
}
