import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'

const logger = createLogger('ExecutionEventBuffer')

const REDIS_PREFIX = 'execution:stream:'
const TTL_SECONDS = 60 * 60 // 1 hour
const EVENT_LIMIT = 1000
const RESERVE_BATCH = 100
const FLUSH_INTERVAL_MS = 15
const FLUSH_MAX_BATCH = 200
const MAX_PENDING_EVENTS = 1000
const ACTIVE_META_ATTEMPTS = 3
const FINALIZE_FLUSH_ATTEMPTS = 2
const FLUSH_EVENTS_SCRIPT = `
local terminal_status = ARGV[4]
for i = 5, #ARGV, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[2]) - 1)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if terminal_status ~= '' then
  redis.call('HSET', KEYS[3], 'status', terminal_status, 'updatedAt', ARGV[3])
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[1]))
end
if oldest[2] then
  redis.call('HSET', KEYS[3], 'earliestEventId', tostring(math.floor(tonumber(oldest[2]))), 'updatedAt', ARGV[3])
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[1]))
end
return oldest[2] or false
`

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

function isExecutionStreamStatus(value: string | undefined): value is ExecutionStreamStatus {
  return value === 'active' || value === 'complete' || value === 'error' || value === 'cancelled'
}

export interface ExecutionStreamMeta {
  status: ExecutionStreamStatus
  userId?: string
  workflowId?: string
  updatedAt?: string
  earliestEventId?: number
  replayStartEventId?: number
}

export type TerminalExecutionStreamStatus = Exclude<ExecutionStreamStatus, 'active'>

export type ExecutionMetaReadResult =
  | { status: 'found'; meta: ExecutionStreamMeta }
  | { status: 'missing' }
  | { status: 'unavailable'; error: string }

export type ExecutionEventsReadResult =
  | { status: 'ok'; events: ExecutionEventEntry[] }
  | { status: 'pruned'; earliestEventId: number }
  | { status: 'unavailable'; error: string }

export interface ExecutionEventEntry {
  eventId: number
  executionId: string
  event: ExecutionEvent
}

interface MemoryExecutionStream {
  events: ExecutionEventEntry[]
  meta: ExecutionStreamMeta | null
  nextEventId: number
  expiresAt: number
}

export interface ExecutionEventWriter {
  write: (event: ExecutionEvent) => Promise<ExecutionEventEntry>
  writeTerminal: (
    event: ExecutionEvent,
    status: TerminalExecutionStreamStatus
  ) => Promise<ExecutionEventEntry>
  flush: () => Promise<void>
  close: () => Promise<void>
}

const memoryExecutionStreams = new Map<string, MemoryExecutionStream>()

function canUseMemoryEventBuffer(): boolean {
  return typeof window === 'undefined' && !env.REDIS_URL
}

function pruneExpiredMemoryStreams(now = Date.now()): void {
  for (const [executionId, stream] of memoryExecutionStreams) {
    if (stream.expiresAt <= now) {
      memoryExecutionStreams.delete(executionId)
    }
  }
}

function getMemoryStream(executionId: string): MemoryExecutionStream {
  pruneExpiredMemoryStreams()
  let stream = memoryExecutionStreams.get(executionId)
  if (!stream) {
    stream = {
      events: [],
      meta: null,
      nextEventId: 1,
      expiresAt: Date.now() + TTL_SECONDS * 1000,
    }
    memoryExecutionStreams.set(executionId, stream)
  }
  return stream
}

function touchMemoryStream(stream: MemoryExecutionStream): void {
  stream.expiresAt = Date.now() + TTL_SECONDS * 1000
}

function isReplayBeforeAvailableEvents(
  afterEventId: number,
  earliestEventId?: number,
  replayStartEventId?: number
): earliestEventId is number {
  if (earliestEventId === undefined || !Number.isFinite(earliestEventId)) return false
  if (
    afterEventId === 0 &&
    replayStartEventId !== undefined &&
    Number.isFinite(replayStartEventId)
  ) {
    return earliestEventId > replayStartEventId
  }
  return afterEventId + 1 < earliestEventId
}

function readMemoryMeta(executionId: string): ExecutionMetaReadResult {
  pruneExpiredMemoryStreams()
  const stream = memoryExecutionStreams.get(executionId)
  if (!stream?.meta) return { status: 'missing' }
  return { status: 'found', meta: stream.meta }
}

function readMemoryEvents(executionId: string, afterEventId: number): ExecutionEventsReadResult {
  pruneExpiredMemoryStreams()
  const stream = memoryExecutionStreams.get(executionId)
  if (!stream) return { status: 'ok', events: [] }
  const earliestEventId = stream.meta?.earliestEventId
  if (
    isReplayBeforeAvailableEvents(afterEventId, earliestEventId, stream.meta?.replayStartEventId)
  ) {
    return { status: 'pruned', earliestEventId }
  }
  return {
    status: 'ok',
    events: stream.events.filter((entry) => entry.eventId > afterEventId),
  }
}

function createMemoryExecutionEventWriter(executionId: string): ExecutionEventWriter {
  const writeMemoryEvent = async (event: ExecutionEvent) => {
    const stream = getMemoryStream(executionId)
    const entry = {
      eventId: stream.nextEventId++,
      executionId,
      event,
    }
    stream.events.push(entry)
    if (stream.events.length > EVENT_LIMIT) {
      stream.events = stream.events.slice(-EVENT_LIMIT)
      const earliestEventId = stream.events[0]?.eventId
      if (earliestEventId !== undefined && stream.meta) {
        stream.meta = {
          ...stream.meta,
          earliestEventId,
          updatedAt: new Date().toISOString(),
        }
      }
    }
    touchMemoryStream(stream)
    return entry
  }

  return {
    write: writeMemoryEvent,
    writeTerminal: async (event, status) => {
      const entry = await writeMemoryEvent(event)
      const stream = getMemoryStream(executionId)
      stream.meta = {
        ...stream.meta,
        status,
        updatedAt: new Date().toISOString(),
      }
      touchMemoryStream(stream)
      return entry
    },
    flush: async () => {},
    close: async () => {},
  }
}

export async function flushExecutionStreamReplayBuffer(
  executionId: string,
  writer: ExecutionEventWriter
): Promise<boolean> {
  let writerClosed = false
  for (let attempt = 1; attempt <= FINALIZE_FLUSH_ATTEMPTS; attempt++) {
    try {
      if (!writerClosed) {
        await writer.close()
        writerClosed = true
      }
      return true
    } catch (error) {
      logger.warn('Failed to flush execution stream replay buffer during finalization', {
        executionId,
        attempt,
        error: toError(error).message,
      })
    }
  }
  return false
}

export async function resetExecutionStreamBuffer(executionId: string): Promise<boolean> {
  if (canUseMemoryEventBuffer()) {
    const stream = getMemoryStream(executionId)
    stream.events = []
    stream.meta = {
      status: 'active',
      replayStartEventId: stream.nextEventId,
      updatedAt: new Date().toISOString(),
    }
    stream.expiresAt = Date.now() + TTL_SECONDS * 1000
    return true
  }

  const redis = getRedisClient()
  if (!redis) {
    logger.warn('resetExecutionStreamBuffer: Redis client unavailable', { executionId })
    return false
  }

  try {
    const currentSequence = Number(await redis.get(getSeqKey(executionId)).catch(() => 0))
    const replayStartEventId = Number.isFinite(currentSequence) ? currentSequence + 1 : 1
    const metaKey = getMetaKey(executionId)
    await redis.del(getEventsKey(executionId), metaKey)
    await redis.hset(metaKey, {
      replayStartEventId: String(replayStartEventId),
      updatedAt: new Date().toISOString(),
    })
    await redis.expire(metaKey, TTL_SECONDS)
    return true
  } catch (error) {
    logger.warn('Failed to reset execution stream buffer', {
      executionId,
      error: toError(error).message,
    })
    return false
  }
}

export async function setExecutionMeta(
  executionId: string,
  meta: Partial<ExecutionStreamMeta>
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      const stream = getMemoryStream(executionId)
      const status = meta.status ?? stream.meta?.status
      if (!status) return false
      stream.meta = {
        ...stream.meta,
        ...meta,
        status,
        updatedAt: new Date().toISOString(),
      }
      touchMemoryStream(stream)
      return true
    }
    logger.warn('setExecutionMeta: Redis client unavailable', { executionId })
    return false
  }
  try {
    const key = getMetaKey(executionId)
    const payload: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    }
    if (meta.status) payload.status = meta.status
    if (meta.userId) payload.userId = meta.userId
    if (meta.workflowId) payload.workflowId = meta.workflowId
    if (meta.earliestEventId !== undefined) payload.earliestEventId = String(meta.earliestEventId)
    if (meta.replayStartEventId !== undefined) {
      payload.replayStartEventId = String(meta.replayStartEventId)
    }
    await redis.hset(key, payload)
    await redis.expire(key, TTL_SECONDS)
    return true
  } catch (error) {
    logger.warn('Failed to update execution meta', {
      executionId,
      error: toError(error).message,
    })
    return false
  }
}

export async function initializeExecutionStreamMeta(
  executionId: string,
  meta: Omit<ExecutionStreamMeta, 'status' | 'updatedAt'> & { status?: 'active' }
): Promise<boolean> {
  for (let attempt = 1; attempt <= ACTIVE_META_ATTEMPTS; attempt++) {
    const metaPersisted = await setExecutionMeta(executionId, {
      ...meta,
      status: 'active',
    })
    if (metaPersisted) return true
    logger.warn('Failed to persist active execution meta during initialization', {
      executionId,
      attempt,
    })
  }
  return false
}

export async function readExecutionMetaState(
  executionId: string
): Promise<ExecutionMetaReadResult> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      return readMemoryMeta(executionId)
    }
    logger.warn('getExecutionMeta: Redis client unavailable', { executionId })
    return { status: 'unavailable', error: 'Redis client unavailable' }
  }
  try {
    const key = getMetaKey(executionId)
    const meta = await redis.hgetall(key)
    if (!meta || Object.keys(meta).length === 0) return { status: 'missing' }
    if (!isExecutionStreamStatus(meta.status)) return { status: 'missing' }
    return {
      status: 'found',
      meta: {
        status: meta.status,
        userId: meta.userId,
        workflowId: meta.workflowId,
        updatedAt: meta.updatedAt,
        earliestEventId:
          meta.earliestEventId !== undefined ? Number(meta.earliestEventId) : undefined,
        replayStartEventId:
          meta.replayStartEventId !== undefined ? Number(meta.replayStartEventId) : undefined,
      },
    }
  } catch (error) {
    const message = toError(error).message
    logger.warn('Failed to read execution meta', {
      executionId,
      error: message,
    })
    return { status: 'unavailable', error: message }
  }
}

export async function getExecutionMeta(executionId: string): Promise<ExecutionStreamMeta | null> {
  const result = await readExecutionMetaState(executionId)
  if (result.status === 'found') return result.meta
  if (result.status === 'unavailable') {
    return null
  }
  return null
}

export async function readExecutionEvents(
  executionId: string,
  afterEventId: number
): Promise<ExecutionEventEntry[]> {
  const result = await readExecutionEventsState(executionId, afterEventId)
  return result.status === 'ok' ? result.events : []
}

export async function readExecutionEventsState(
  executionId: string,
  afterEventId: number
): Promise<ExecutionEventsReadResult> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      return readMemoryEvents(executionId, afterEventId)
    }
    return { status: 'unavailable', error: 'Redis client unavailable' }
  }
  try {
    const meta = await redis.hgetall(getMetaKey(executionId))
    const earliestEventId =
      meta?.earliestEventId !== undefined ? Number(meta.earliestEventId) : undefined
    const replayStartEventId =
      meta?.replayStartEventId !== undefined ? Number(meta.replayStartEventId) : undefined
    if (isReplayBeforeAvailableEvents(afterEventId, earliestEventId, replayStartEventId)) {
      return { status: 'pruned', earliestEventId }
    }

    const raw = await redis.zrangebyscore(getEventsKey(executionId), afterEventId + 1, '+inf')
    const latestMeta = await redis.hgetall(getMetaKey(executionId))
    const latestEarliestEventId =
      latestMeta?.earliestEventId !== undefined ? Number(latestMeta.earliestEventId) : undefined
    const latestReplayStartEventId =
      latestMeta?.replayStartEventId !== undefined
        ? Number(latestMeta.replayStartEventId)
        : undefined
    if (
      isReplayBeforeAvailableEvents(afterEventId, latestEarliestEventId, latestReplayStartEventId)
    ) {
      return { status: 'pruned', earliestEventId: latestEarliestEventId }
    }

    return {
      status: 'ok',
      events: raw
        .map((entry) => {
          try {
            return JSON.parse(entry) as ExecutionEventEntry
          } catch {
            return null
          }
        })
        .filter((entry): entry is ExecutionEventEntry => Boolean(entry)),
    }
  } catch (error) {
    const message = toError(error).message
    logger.warn('Failed to read execution events', {
      executionId,
      error: message,
    })
    return { status: 'unavailable', error: message }
  }
}

export function createExecutionEventWriter(executionId: string): ExecutionEventWriter {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      logger.info('createExecutionEventWriter: using in-memory event buffer', { executionId })
      return createMemoryExecutionEventWriter(executionId)
    }
    logger.warn(
      'createExecutionEventWriter: Redis client unavailable, events will not be buffered',
      {
        executionId,
      }
    )
    return {
      write: async (event) => ({ eventId: 0, executionId, event }),
      writeTerminal: async () => {
        throw new Error(`Execution event buffer unavailable for ${executionId}`)
      },
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
      void flushPending()
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

  let flushPromise: Promise<boolean> | null = null
  let closed = false
  let writeQueue: Promise<void> = Promise.resolve()
  const inflightWrites = new Set<Promise<ExecutionEventEntry>>()
  let writeFailure: Error | null = null

  const doFlush = async (terminalStatus?: TerminalExecutionStreamStatus): Promise<boolean> => {
    if (pending.length === 0) return true
    const batch = pending
    pending = []
    try {
      const key = getEventsKey(executionId)
      const zaddArgs: (string | number)[] = []
      for (const entry of batch) {
        zaddArgs.push(entry.eventId, JSON.stringify(entry))
      }
      await redis.eval(
        FLUSH_EVENTS_SCRIPT,
        3,
        key,
        getSeqKey(executionId),
        getMetaKey(executionId),
        TTL_SECONDS,
        EVENT_LIMIT,
        new Date().toISOString(),
        terminalStatus ?? '',
        ...zaddArgs
      )
      return true
    } catch (error) {
      logger.warn('Failed to flush execution events', {
        executionId,
        batchSize: batch.length,
        error: toError(error).message,
        stack: error instanceof Error ? error.stack : undefined,
      })
      pending = batch.concat(pending)
      if (pending.length > MAX_PENDING_EVENTS) {
        const dropped = pending.length - MAX_PENDING_EVENTS
        pending = pending.slice(-MAX_PENDING_EVENTS)
        logger.warn('Dropped oldest pending events due to sustained Redis failure', {
          executionId,
          dropped,
          remaining: pending.length,
        })
      }
      return false
    }
  }

  const flushPending = async (
    scheduleOnFailure = true,
    terminalStatus?: TerminalExecutionStreamStatus
  ): Promise<boolean> => {
    while (true) {
      if (flushPromise) {
        const ok = await flushPromise
        if (!ok) return false
        continue
      }
      if (pending.length === 0) return true

      flushPromise = doFlush(terminalStatus)
      let ok = false
      try {
        ok = await flushPromise
      } finally {
        flushPromise = null
      }
      if (!ok) {
        if (scheduleOnFailure && pending.length > 0) scheduleFlush()
        return false
      }
    }
  }

  const writeCore = async (event: ExecutionEvent): Promise<ExecutionEventEntry> => {
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      await reserveIds(1)
    }
    const eventId = nextEventId++
    const entry: ExecutionEventEntry = { eventId, executionId, event }
    pending.push(entry)
    if (pending.length >= FLUSH_MAX_BATCH) {
      await flushPending()
    } else {
      scheduleFlush()
    }
    return entry
  }

  const write = (event: ExecutionEvent): Promise<ExecutionEventEntry> => {
    if (closed) return Promise.resolve({ eventId: 0, executionId, event })
    const p = writeQueue.then(() => writeCore(event))
    writeQueue = p.then(
      () => {
        writeFailure = null
      },
      (error) => {
        writeFailure = toError(error)
      }
    )
    inflightWrites.add(p)
    const remove = () => inflightWrites.delete(p)
    p.then(remove, remove)
    return p
  }

  const writeTerminal = (
    event: ExecutionEvent,
    status: TerminalExecutionStreamStatus
  ): Promise<ExecutionEventEntry> => {
    if (closed) return Promise.resolve({ eventId: 0, executionId, event })
    const p = writeQueue.then(async () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (nextEventId === 0 || nextEventId > maxReservedId) {
        await reserveIds(1)
      }
      const eventId = nextEventId++
      const entry: ExecutionEventEntry = { eventId, executionId, event }
      pending.push(entry)
      const ok = await flushPending(false, status)
      if (!ok) {
        pending = pending.filter((pendingEntry) => pendingEntry !== entry)
        throw new Error(`Failed to flush terminal execution event for ${executionId}`)
      }
      closed = true
      return entry
    })
    writeQueue = p.then(
      () => {
        writeFailure = null
      },
      (error) => {
        writeFailure = toError(error)
      }
    )
    inflightWrites.add(p)
    const remove = () => inflightWrites.delete(p)
    p.then(remove, remove)
    return p
  }

  const close = async () => {
    closed = true
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (inflightWrites.size > 0) {
      await Promise.allSettled(inflightWrites)
    }
    if (flushPromise) {
      await flushPromise
    }
    await flushCore(false)
  }

  const flushCore = async (scheduleOnFailure: boolean) => {
    await writeQueue
    const ok = await flushPending(scheduleOnFailure)
    if (writeFailure) {
      throw writeFailure
    }
    if (!ok) {
      throw new Error(`Failed to flush execution events for ${executionId}`)
    }
  }

  const flush = async () => {
    await flushCore(true)
  }

  return { write, writeTerminal, flush, close }
}
