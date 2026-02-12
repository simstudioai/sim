import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'

const logger = createLogger('ExecutionEventBuffer')

const REDIS_PREFIX = 'execution:stream:'
const TTL_SECONDS = 60 * 60 // 1 hour
const EVENT_LIMIT = 1000
const RESERVE_BATCH = 100
const FLUSH_INTERVAL_MS = 15
const FLUSH_MAX_BATCH = 200

function getEventsKey(executionId: string) {
  return `${REDIS_PREFIX}${executionId}:events`
}

function getSeqKey(executionId: string) {
  return `${REDIS_PREFIX}${executionId}:seq`
}

function getMetaKey(executionId: string) {
  return `${REDIS_PREFIX}${executionId}:meta`
}

export type ExecutionStreamStatus = 'active' | 'complete' | 'error' | 'cancelled'

export interface ExecutionStreamMeta {
  status: ExecutionStreamStatus
  userId?: string
  workflowId?: string
  updatedAt?: string
}

export interface ExecutionEventEntry {
  eventId: number
  executionId: string
  event: ExecutionEvent
}

export interface ExecutionEventWriter {
  write: (event: ExecutionEvent) => Promise<ExecutionEventEntry>
  flush: () => Promise<void>
  close: () => Promise<void>
}

export async function setExecutionMeta(
  executionId: string,
  meta: Partial<ExecutionStreamMeta>
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('setExecutionMeta: Redis client unavailable', { executionId })
    return
  }
  try {
    const key = getMetaKey(executionId)
    const payload: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    }
    if (meta.status) payload.status = meta.status
    if (meta.userId) payload.userId = meta.userId
    if (meta.workflowId) payload.workflowId = meta.workflowId
    await redis.hset(key, payload)
    await redis.expire(key, TTL_SECONDS)
  } catch (error) {
    logger.warn('Failed to update execution meta', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getExecutionMeta(executionId: string): Promise<ExecutionStreamMeta | null> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('getExecutionMeta: Redis client unavailable', { executionId })
    return null
  }
  try {
    const key = getMetaKey(executionId)
    const meta = await redis.hgetall(key)
    if (!meta || Object.keys(meta).length === 0) return null
    return meta as unknown as ExecutionStreamMeta
  } catch (error) {
    logger.warn('Failed to read execution meta', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function readExecutionEvents(
  executionId: string,
  afterEventId: number
): Promise<ExecutionEventEntry[]> {
  const redis = getRedisClient()
  if (!redis) return []
  try {
    const raw = await redis.zrangebyscore(getEventsKey(executionId), afterEventId + 1, '+inf')
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as ExecutionEventEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is ExecutionEventEntry => Boolean(entry))
  } catch (error) {
    logger.warn('Failed to read execution events', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function createExecutionEventWriter(executionId: string): ExecutionEventWriter {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn(
      'createExecutionEventWriter: Redis client unavailable, events will not be buffered',
      {
        executionId,
      }
    )
    return {
      write: async (event) => ({ eventId: 0, executionId, event }),
      flush: async () => {},
      close: async () => {},
    }
  }

  let pending: ExecutionEventEntry[] = []
  let nextEventId = 0
  let maxReservedId = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, FLUSH_INTERVAL_MS)
  }

  const reserveIds = async (minCount: number) => {
    const reserveCount = Math.max(RESERVE_BATCH, minCount)
    const newMax = await redis.incrby(getSeqKey(executionId), reserveCount)
    const startId = newMax - reserveCount + 1
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      nextEventId = startId
      maxReservedId = newMax
    }
  }

  let flushPromise: Promise<void> | null = null
  let closed = false

  const doFlush = async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    try {
      const key = getEventsKey(executionId)
      const zaddArgs: (string | number)[] = []
      for (const entry of batch) {
        zaddArgs.push(entry.eventId, JSON.stringify(entry))
      }
      const pipeline = redis.pipeline()
      pipeline.zadd(key, ...zaddArgs)
      pipeline.expire(key, TTL_SECONDS)
      pipeline.expire(getSeqKey(executionId), TTL_SECONDS)
      pipeline.zremrangebyrank(key, 0, -EVENT_LIMIT - 1)
      await pipeline.exec()
    } catch (error) {
      logger.warn('Failed to flush execution events', {
        executionId,
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      pending = batch.concat(pending)
    }
  }

  const flush = async () => {
    if (flushPromise) {
      await flushPromise
      return
    }
    flushPromise = doFlush()
    try {
      await flushPromise
    } finally {
      flushPromise = null
      if (pending.length > 0) scheduleFlush()
    }
  }

  const write = async (event: ExecutionEvent) => {
    if (closed) return { eventId: 0, executionId, event }
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      await reserveIds(1)
    }
    const eventId = nextEventId++
    const entry: ExecutionEventEntry = { eventId, executionId, event }
    pending.push(entry)
    if (pending.length >= FLUSH_MAX_BATCH) {
      await flush()
    } else {
      scheduleFlush()
    }
    return entry
  }

  const close = async () => {
    closed = true
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    // Wait for any in-flight flush to complete
    if (flushPromise) {
      await flushPromise
    }
    // Drain any remaining events that accumulated during the wait
    if (pending.length > 0) {
      await doFlush()
    }
  }

  return { write, flush, close }
}
