import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { randomInt } from '@sim/utils/random'
import { getConfiguredCacheProvider } from '@/lib/core/config/env-capabilities.server'
import { getRedisClient } from '@/lib/core/config/redis'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getRedisBudgetKeys, getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'
import {
  getExecutionSignalChannel,
  publishLocalExecutionSignal,
} from '@/lib/execution/execution-signal'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import {
  ExecutionResourceLimitError,
  isExecutionResourceLimitError,
} from '@/lib/execution/resource-errors'
import type { BlockStartedData, ExecutionEvent } from '@/lib/workflows/executor/execution-events'

const logger = createLogger('ExecutionEventBuffer')

const REDIS_PREFIX = 'execution:stream:'
export const EXECUTION_STREAM_PROTOCOL_VERSION = 1
const TERMINAL_TTL_SECONDS = 60 * 60
const ACTIVE_TTL_SECONDS = Math.ceil(getMaxExecutionTimeout() / 1000) + TERMINAL_TTL_SECONDS
const EVENT_LIMIT = 1000
const RESERVE_BATCH = 100
const FLUSH_INTERVAL_MS = 15
const FLUSH_MAX_RETRY_INTERVAL_MS = 1000
const FLUSH_MAX_BATCH = 200
const MAX_PENDING_EVENTS = 1000
const MAX_ACTIVE_BLOCK_SNAPSHOT_BYTES = 256 * 1024
/**
 * Bytes a single execution may buffer before its events start offloading
 * aggressively, and the per-value threshold applied once it does.
 *
 * The buffer holds `EVENT_LIMIT` events inside the per-execution byte budget,
 * so a full ring only fits if events average under budget/EVENT_LIMIT. Applying
 * that ceiling to every run would offload ordinary block outputs into refs the
 * terminal cannot display — the SSE stream carries the compacted event, and a
 * ref renders only as a preview. Instead the tight ceiling engages only once a
 * run has actually buffered its way into the danger zone, so a short run keeps
 * full-fidelity output and a runaway one stops accumulating.
 */
const EXECUTION_EVENT_OFFLOAD_PRESSURE_BYTES = getRedisBudgetLimits('execution').maxOwnerBytes / 2
const EXECUTION_EVENT_PRESSURE_VALUE_BYTES =
  getRedisBudgetLimits('execution').maxOwnerBytes / EVENT_LIMIT
const ACTIVE_META_ATTEMPTS = 3
const FINALIZE_FLUSH_ATTEMPTS = 2
const FLUSH_EVENTS_SCRIPT = `
local terminal_status = ARGV[4]
local batch_bytes = tonumber(ARGV[5])
local execution_limit = tonumber(ARGV[6])
local user_limit = tonumber(ARGV[7])
local budget_ttl_seconds = tonumber(ARGV[8])
local event_limit = tonumber(ARGV[2])
local new_count = 0
local new_bytes = 0
local new_entries = {}
for i = 9, #ARGV, 2 do
  local entry = ARGV[i + 1]
  if not redis.call('ZSCORE', KEYS[1], entry) then
    new_count = new_count + 1
    new_bytes = new_bytes + string.len(entry)
    table.insert(new_entries, entry)
  end
end
local current_count = redis.call('ZCARD', KEYS[1])
local prune_count = current_count + new_count - event_limit
local pruned = {}
if prune_count < 0 then
  prune_count = 0
end
local existing_prune_count = math.min(prune_count, current_count)
local new_prune_count = prune_count - existing_prune_count
if existing_prune_count > 0 then
  pruned = redis.call('ZRANGE', KEYS[1], 0, existing_prune_count - 1)
end
local pruned_bytes = 0
for _, entry in ipairs(pruned) do
  pruned_bytes = pruned_bytes + string.len(entry)
end
for i = 1, new_prune_count do
  local entry = new_entries[i]
  if entry then
    pruned_bytes = pruned_bytes + string.len(entry)
  end
end
local net_bytes = new_bytes - pruned_bytes
if net_bytes > 0 then
  local execution_current = tonumber(redis.call('GET', KEYS[5]) or '0')
  if execution_limit > 0 and execution_current + net_bytes > execution_limit then
    return {0, 'execution_redis_bytes', execution_current, pruned_bytes}
  end
  local user_current = 0
  if #KEYS >= 6 then
    user_current = tonumber(redis.call('GET', KEYS[6]) or '0')
    if user_limit > 0 and user_current + net_bytes > user_limit then
      return {0, 'user_redis_bytes', user_current, pruned_bytes}
    end
  end
  redis.call('INCRBY', KEYS[5], net_bytes)
  redis.call('EXPIRE', KEYS[5], budget_ttl_seconds)
  if #KEYS >= 6 then
    redis.call('INCRBY', KEYS[6], net_bytes)
    if redis.call('TTL', KEYS[6]) < 0 then
      redis.call('EXPIRE', KEYS[6], budget_ttl_seconds)
    end
  end
elseif net_bytes < 0 then
  local release_bytes = -net_bytes
  local execution_next = redis.call('DECRBY', KEYS[5], release_bytes)
  if execution_next <= 0 then
    redis.call('DEL', KEYS[5])
  else
    redis.call('EXPIRE', KEYS[5], budget_ttl_seconds)
  end
  if #KEYS >= 6 then
    local user_next = redis.call('DECRBY', KEYS[6], release_bytes)
    if user_next <= 0 then
      redis.call('DEL', KEYS[6])
    elseif redis.call('TTL', KEYS[6]) < 0 then
      redis.call('EXPIRE', KEYS[6], budget_ttl_seconds)
    end
  end
else
  if redis.call('EXISTS', KEYS[5]) == 1 then
    redis.call('EXPIRE', KEYS[5], budget_ttl_seconds)
  end
  if #KEYS >= 6 and redis.call('EXISTS', KEYS[6]) == 1 and redis.call('TTL', KEYS[6]) < 0 then
    redis.call('EXPIRE', KEYS[6], budget_ttl_seconds)
  end
end
for i = 9, #ARGV, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[2]) - 1)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if terminal_status ~= '' then
  redis.call('HSET', KEYS[3], 'status', terminal_status, 'updatedAt', ARGV[3], 'activeBlockStarts', '[]')
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[1]))
end
if oldest[2] then
  redis.call('HSET', KEYS[3], 'earliestEventId', tostring(math.floor(tonumber(oldest[2]))), 'updatedAt', ARGV[3])
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[1]))
end
redis.call('PUBLISH', KEYS[4], 'event')
return {1, oldest[2] or false, pruned_bytes}
`
const MARK_TERMINAL_META_SCRIPT = `
redis.call('HSET', KEYS[1], 'status', ARGV[1], 'updatedAt', ARGV[2], 'activeBlockStarts', '[]')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('PUBLISH', KEYS[2], 'event')
return 1
`
const SET_ACTIVE_BLOCK_STARTS_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status == 'complete' or status == 'error' or status == 'cancelled' then
  return 1
end
redis.call('HSET', KEYS[1], 'activeBlockStarts', ARGV[1], 'updatedAt', ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('PUBLISH', KEYS[2], 'event')
return 1
`
const RESET_STREAM_SCRIPT = `
local entries = redis.call('ZRANGE', KEYS[1], 0, -1)
local retained_bytes = 0
for _, entry in ipairs(entries) do
  retained_bytes = retained_bytes + string.len(entry)
end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[2], 'replayStartEventId', ARGV[1], 'updatedAt', ARGV[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
if retained_bytes > 0 then
  local execution_next = redis.call('DECRBY', KEYS[3], retained_bytes)
  if execution_next <= 0 then
    redis.call('DEL', KEYS[3])
  else
    redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
  end
  if #KEYS >= 4 then
    local user_next = redis.call('DECRBY', KEYS[4], retained_bytes)
    if user_next <= 0 then
      redis.call('DEL', KEYS[4])
    elseif redis.call('TTL', KEYS[4]) < 0 then
      redis.call('EXPIRE', KEYS[4], tonumber(ARGV[4]))
    end
  end
end
return retained_bytes
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

function getJsonSize(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return null
  }
}

function getFlushScriptResult(value: unknown): {
  allowed: boolean
  resource?: string
  currentBytes?: number
} {
  if (Array.isArray(value)) {
    return {
      allowed: Number(value[0]) === 1,
      resource: typeof value[1] === 'string' ? value[1] : undefined,
      currentBytes: Number(value[2] ?? 0),
    }
  }
  return { allowed: true }
}

function trimFinalBlockLogsForEventData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data

  const record = data as Record<string, unknown>
  const finalBlockLogs = record.finalBlockLogs
  if (!Array.isArray(finalBlockLogs)) return data
  const originalSize = getJsonSize(data)
  if (originalSize !== null && originalSize <= LARGE_VALUE_THRESHOLD_BYTES) return data

  const total = finalBlockLogs.length
  let logs = finalBlockLogs
  let trimmed: Record<string, unknown> = {
    ...record,
    finalBlockLogs: logs,
    finalBlockLogsTruncated: true,
    finalBlockLogsTotal: total,
  }

  while (logs.length > 0) {
    const size = getJsonSize(trimmed)
    if (size !== null && size <= LARGE_VALUE_THRESHOLD_BYTES) {
      return trimmed
    }

    logs = logs.length === 1 ? [] : logs.slice(Math.ceil(logs.length / 2))
    trimmed = {
      ...record,
      finalBlockLogs: logs,
      finalBlockLogsTruncated: true,
      finalBlockLogsTotal: total,
    }
  }

  return trimmed
}

export interface ExecutionStreamMeta {
  status: ExecutionStreamStatus
  protocolVersion?: number
  userId?: string
  workflowId?: string
  updatedAt?: string
  earliestEventId?: number
  replayStartEventId?: number
  activeBlockStarts?: ActiveBlockStartSnapshot[]
}

export interface ActiveBlockStartSnapshot {
  eventId: number
  data: BlockStartedData
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

export interface ExecutionEventWriterContext extends LargeValueStoreContext {
  requireDurablePayloads?: boolean
  preserveUserFileBase64?: boolean
  /** Offload ceiling for individual values; defaults to the shared large-value cap. */
  valueThresholdBytes?: number
}

async function compactEventForBuffer(
  event: ExecutionEvent,
  context: ExecutionEventWriterContext = {}
): Promise<ExecutionEvent> {
  if (!('data' in event)) {
    return event
  }

  const baseOptions = {
    ...context,
    executionId: context.executionId ?? event.executionId,
    requireDurable: context.requireDurablePayloads,
    preserveRoot: true,
    thresholdBytes: context.valueThresholdBytes,
  }

  let compactedData = await compactExecutionPayload(event.data, {
    ...baseOptions,
    preserveUserFileBase64: context.preserveUserFileBase64,
  })
  let eventData = trimFinalBlockLogsForEventData(compactedData)
  let eventDataSize = getJsonSize(eventData)

  // SSE/replay events are size-bounded by LARGE_VALUE_THRESHOLD_BYTES. When a
  // payload that preserved UserFile base64 (e.g., for chat/streaming) exceeds
  // the cap, recompact the already-compacted result with base64 stripped so
  // consumers can lazily re-hydrate via sim.files.readBase64. Recompacting the
  // *compacted* value (not the raw event.data) lets existing LargeValueRefs
  // pass through unchanged and avoids minting fresh storage objects for the
  // same large fields.
  if (
    context.preserveUserFileBase64 &&
    eventDataSize !== null &&
    eventDataSize > LARGE_VALUE_THRESHOLD_BYTES
  ) {
    const oversizedBytes = eventDataSize
    compactedData = await compactExecutionPayload(compactedData, {
      ...baseOptions,
      preserveUserFileBase64: false,
    })
    eventData = trimFinalBlockLogsForEventData(compactedData)
    eventDataSize = getJsonSize(eventData)
    logger.warn('Stripped inline UserFile base64 from execution event to fit size limit', {
      executionId: baseOptions.executionId,
      eventType: 'type' in event ? event.type : undefined,
      thresholdBytes: LARGE_VALUE_THRESHOLD_BYTES,
      originalBytes: oversizedBytes,
      strippedBytes: eventDataSize,
    })
  }

  if (eventDataSize !== null && eventDataSize > LARGE_VALUE_THRESHOLD_BYTES) {
    throw new Error(
      `Execution event data remains too large after compaction (${eventDataSize} bytes)`
    )
  }

  return { ...event, data: eventData } as ExecutionEvent
}

const memoryExecutionStreams = new Map<string, MemoryExecutionStream>()

function canUseMemoryEventBuffer(): boolean {
  return typeof window === 'undefined' && getConfiguredCacheProvider() === 'database'
}

function pruneExpiredMemoryStreams(now = Date.now()): void {
  for (const [executionId, stream] of memoryExecutionStreams) {
    if (stream.expiresAt <= now) memoryExecutionStreams.delete(executionId)
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
      expiresAt: Date.now() + ACTIVE_TTL_SECONDS * 1000,
    }
    memoryExecutionStreams.set(executionId, stream)
  }
  return stream
}

function touchMemoryStream(stream: MemoryExecutionStream): void {
  const terminal = stream.meta?.status && stream.meta.status !== 'active'
  stream.expiresAt = Date.now() + (terminal ? TERMINAL_TTL_SECONDS : ACTIVE_TTL_SECONDS) * 1000
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

function createMemoryExecutionEventWriter(
  executionId: string,
  context: ExecutionEventWriterContext = {}
): ExecutionEventWriter {
  const writeMemoryEvent = async (event: ExecutionEvent, publish: boolean) => {
    const stream = getMemoryStream(executionId)
    const compactEvent = await compactEventForBuffer(event, context)
    const entry = {
      eventId: stream.nextEventId++,
      executionId,
      event: compactEvent,
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
    if (publish) publishLocalExecutionSignal(executionId, 'event')
    return entry
  }

  return {
    write: (event) => writeMemoryEvent(event, true),
    writeTerminal: async (event, status) => {
      const entry = await writeMemoryEvent(event, false)
      const stream = getMemoryStream(executionId)
      stream.meta = {
        ...stream.meta,
        status,
        updatedAt: new Date().toISOString(),
        activeBlockStarts: [],
      }
      touchMemoryStream(stream)
      publishLocalExecutionSignal(executionId, 'event')
      return entry
    },
    flush: async () => {},
    close: async () => {},
  }
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
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      const stream = getMemoryStream(executionId)
      stream.events = []
      stream.meta = {
        status: 'active',
        protocolVersion: EXECUTION_STREAM_PROTOCOL_VERSION,
        replayStartEventId: stream.nextEventId,
        updatedAt: new Date().toISOString(),
        activeBlockStarts: [],
      }
      touchMemoryStream(stream)
      return true
    }
    logger.warn('resetExecutionStreamBuffer: Redis client unavailable', { executionId })
    return false
  }

  try {
    const currentSequence = Number(await redis.get(getSeqKey(executionId)).catch(() => 0))
    const replayStartEventId = Number.isFinite(currentSequence) ? currentSequence + 1 : 1
    const metaKey = getMetaKey(executionId)
    const meta = (await redis.hgetall(metaKey).catch(() => ({}))) as Record<string, string>
    const userId = typeof meta.userId === 'string' ? meta.userId : undefined
    const budgetKeys = getRedisBudgetKeys({ kind: 'execution', id: executionId, userId })
    await redis.eval(
      RESET_STREAM_SCRIPT,
      2 + budgetKeys.length,
      getEventsKey(executionId),
      metaKey,
      ...budgetKeys,
      String(replayStartEventId),
      new Date().toISOString(),
      ACTIVE_TTL_SECONDS,
      getRedisBudgetLimits('execution').ttlSeconds
    )
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
      if (meta.activeBlockStarts !== undefined) {
        const activeBlockStarts = JSON.stringify(meta.activeBlockStarts)
        if (
          meta.activeBlockStarts.length > EVENT_LIMIT ||
          Buffer.byteLength(activeBlockStarts, 'utf8') > MAX_ACTIVE_BLOCK_SNAPSHOT_BYTES
        ) {
          return false
        }
      }
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
    if (meta.protocolVersion !== undefined) {
      payload.protocolVersion = String(meta.protocolVersion)
    }
    if (meta.userId) payload.userId = meta.userId
    if (meta.workflowId) payload.workflowId = meta.workflowId
    if (meta.earliestEventId !== undefined) payload.earliestEventId = String(meta.earliestEventId)
    if (meta.replayStartEventId !== undefined) {
      payload.replayStartEventId = String(meta.replayStartEventId)
    }
    if (meta.activeBlockStarts !== undefined) {
      const activeBlockStarts = JSON.stringify(meta.activeBlockStarts)
      if (
        meta.activeBlockStarts.length > EVENT_LIMIT ||
        Buffer.byteLength(activeBlockStarts, 'utf8') > MAX_ACTIVE_BLOCK_SNAPSHOT_BYTES
      ) {
        logger.warn('Active execution snapshot exceeds its retention bound', {
          executionId,
          activeBlocks: meta.activeBlockStarts.length,
        })
        return false
      }
      payload.activeBlockStarts = activeBlockStarts
    }
    await redis.hset(key, payload)
    const ttlSeconds =
      meta.status && meta.status !== 'active' ? TERMINAL_TTL_SECONDS : ACTIVE_TTL_SECONDS
    await redis.expire(key, ttlSeconds)
    return true
  } catch (error) {
    logger.warn('Failed to update execution meta', {
      executionId,
      error: toError(error).message,
    })
    return false
  }
}

export async function setExecutionActiveBlockStarts(
  executionId: string,
  activeBlockStarts: ActiveBlockStartSnapshot[]
): Promise<boolean> {
  if (activeBlockStarts.length > EVENT_LIMIT) {
    logger.warn('Active execution snapshot exceeds its retention bound', {
      executionId,
      activeBlocks: activeBlockStarts.length,
    })
    return false
  }
  const serializedSnapshot = JSON.stringify(activeBlockStarts)
  if (Buffer.byteLength(serializedSnapshot, 'utf8') > MAX_ACTIVE_BLOCK_SNAPSHOT_BYTES) {
    logger.warn('Active execution snapshot exceeds its retention bound', {
      executionId,
      activeBlocks: activeBlockStarts.length,
    })
    return false
  }

  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      const stream = getMemoryStream(executionId)
      if (!stream.meta?.status) return false
      if (stream.meta.status !== 'active') return true
      stream.meta = {
        ...stream.meta,
        activeBlockStarts,
        updatedAt: new Date().toISOString(),
      }
      touchMemoryStream(stream)
      publishLocalExecutionSignal(executionId, 'event')
      return true
    }
    logger.warn('setExecutionActiveBlockStarts: Redis client unavailable', { executionId })
    return false
  }

  try {
    await redis.eval(
      SET_ACTIVE_BLOCK_STARTS_SCRIPT,
      2,
      getMetaKey(executionId),
      getExecutionSignalChannel(executionId),
      serializedSnapshot,
      new Date().toISOString(),
      ACTIVE_TTL_SECONDS
    )
    return true
  } catch (error) {
    logger.warn('Failed to update active execution snapshot', {
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
      protocolVersion: EXECUTION_STREAM_PROTOCOL_VERSION,
    })
    if (metaPersisted) return true
    logger.warn('Failed to persist active execution meta during initialization', {
      executionId,
      attempt,
    })
  }
  return false
}

/** Records a terminal state and wakes observers when the terminal event itself could not persist. */
export async function markExecutionStreamTerminal(
  executionId: string,
  status: TerminalExecutionStreamStatus
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      const stream = getMemoryStream(executionId)
      stream.meta = {
        ...stream.meta,
        status,
        protocolVersion: EXECUTION_STREAM_PROTOCOL_VERSION,
        updatedAt: new Date().toISOString(),
        activeBlockStarts: [],
      }
      touchMemoryStream(stream)
      publishLocalExecutionSignal(executionId, 'event')
      return true
    }
    logger.warn('markExecutionStreamTerminal: Redis client unavailable', { executionId })
    return false
  }
  try {
    await redis.eval(
      MARK_TERMINAL_META_SCRIPT,
      2,
      getMetaKey(executionId),
      getExecutionSignalChannel(executionId),
      status,
      new Date().toISOString(),
      TERMINAL_TTL_SECONDS
    )
    return true
  } catch (error) {
    logger.warn('Failed to mark execution stream terminal', {
      executionId,
      status,
      error: toError(error).message,
    })
    return false
  }
}

export async function readExecutionMetaState(
  executionId: string
): Promise<ExecutionMetaReadResult> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) return readMemoryMeta(executionId)
    logger.warn('readExecutionMetaState: Redis client unavailable', { executionId })
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
        protocolVersion:
          meta.protocolVersion !== undefined ? Number(meta.protocolVersion) : undefined,
        userId: meta.userId,
        workflowId: meta.workflowId,
        updatedAt: meta.updatedAt,
        earliestEventId:
          meta.earliestEventId !== undefined ? Number(meta.earliestEventId) : undefined,
        replayStartEventId:
          meta.replayStartEventId !== undefined ? Number(meta.replayStartEventId) : undefined,
        activeBlockStarts: parseActiveBlockStarts(meta.activeBlockStarts),
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

function parseActiveBlockStarts(value: string | undefined): ActiveBlockStartSnapshot[] | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter(
      (entry): entry is ActiveBlockStartSnapshot =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ActiveBlockStartSnapshot).eventId === 'number' &&
        typeof (entry as ActiveBlockStartSnapshot).data?.blockId === 'string'
    )
  } catch {
    return undefined
  }
}

export async function readExecutionEventsState(
  executionId: string,
  afterEventId: number
): Promise<ExecutionEventsReadResult> {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) return readMemoryEvents(executionId, afterEventId)
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

export function createExecutionEventWriter(
  executionId: string,
  context: ExecutionEventWriterContext = {}
): ExecutionEventWriter {
  const redis = getRedisClient()
  if (!redis) {
    if (canUseMemoryEventBuffer()) {
      logger.info('createExecutionEventWriter: using in-memory event buffer', { executionId })
      return createMemoryExecutionEventWriter(executionId, context)
    }
    throw new Error(`Redis execution event buffer unavailable for ${executionId}`)
  }

  let pending: ExecutionEventEntry[] = []
  let nextEventId = 0
  let maxReservedId = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let consecutiveFlushFailures = 0
  /**
   * Bytes this execution has produced, counted as each event is compacted
   * rather than once a flush succeeds. A burst can be compacted long before the
   * scheduled flush runs, so flush-time accounting would let the very batch that
   * exhausts the budget through at the loose ceiling. Counted gross of
   * ring-buffer pruning too, so the mark is reached early — erring toward
   * offloading sooner is the safe direction.
   */
  let bufferedBytes = 0

  /**
   * Preserved base64 is an explicit request for inline delivery and is already
   * bounded by its own cap and the strip-and-recompact fallback, so pressure
   * never rewrites it into a ref the caller cannot read.
   */
  const getValueThresholdBytes = () => {
    if (context.preserveUserFileBase64) return undefined
    return bufferedBytes >= EXECUTION_EVENT_OFFLOAD_PRESSURE_BYTES
      ? EXECUTION_EVENT_PRESSURE_VALUE_BYTES
      : undefined
  }

  const getFlushDelayMs = () => {
    if (consecutiveFlushFailures === 0) return FLUSH_INTERVAL_MS
    const backoff = Math.min(
      FLUSH_INTERVAL_MS * 2 ** Math.min(consecutiveFlushFailures, 6),
      FLUSH_MAX_RETRY_INTERVAL_MS
    )
    return backoff + randomInt(0, FLUSH_INTERVAL_MS)
  }

  const scheduleFlush = (delayMs = FLUSH_INTERVAL_MS) => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushPending().catch((error) => {
        logger.warn('Scheduled execution event flush failed', {
          executionId,
          error: toError(error).message,
        })
      })
    }, delayMs)
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
  /**
   * Why the most recent flush was rejected, cleared by the next success.
   *
   * Budget rejection is recoverable — the execution counter falls as the ring
   * buffer prunes, and the user counter is shared with the caller's other runs —
   * so it must not latch the writer off. This only preserves the specific reason
   * so a failed terminal flush can report it instead of a generic message.
   */
  let lastResourceLimitError: ExecutionResourceLimitError | null = null
  /**
   * Terminal status awaiting its chunk, scoped to the writer rather than to the
   * `flushPending` call that requested it. A concurrent timer-driven flush can
   * be the loop that drains the final chunk, and it carries no status of its
   * own — reading it from here keeps the run from being written without one.
   */
  let pendingTerminalStatus: TerminalExecutionStreamStatus | undefined
  let writeQueue: Promise<void> = Promise.resolve()
  const inflightWrites = new Set<Promise<ExecutionEventEntry>>()
  let writeFailure: Error | null = null

  /**
   * Largest prefix of `pending` that fits one Redis write, always at least one
   * entry. A burst of large events can otherwise build a batch above the
   * single-write cap that no retry can ever shrink, stalling the buffer for the
   * rest of the run.
   */
  const takeFlushChunk = (maxBytes: number) => {
    const zaddArgs: (string | number)[] = []
    let bytes = 0
    let count = 0
    // Serialize before detaching anything: an entry that cannot be stringified
    // must leave `pending` untouched so the batch is still retried, not silently
    // dropped on the floor.
    while (count < pending.length) {
      const entry = pending[count]
      const entryJson = JSON.stringify(entry)
      const entryBytes = Buffer.byteLength(entryJson, 'utf8')
      if (count > 0 && bytes + entryBytes > maxBytes) break
      zaddArgs.push(entry.eventId, entryJson)
      bytes += entryBytes
      count += 1
      if (bytes > maxBytes) break
    }
    const entries = pending.slice(0, count)
    pending = pending.slice(count)
    return { entries, zaddArgs, bytes }
  }

  /**
   * Abandon a terminal entry whose publish failed. The status must be dropped
   * with it: leaving it armed would let a later `flush()`/`close()` stamp the
   * stream terminal for an event that was discarded, contradicting the failure
   * just reported to the caller.
   */
  const discardTerminalEntry = (entry: ExecutionEventEntry) => {
    pending = pending.filter((pendingEntry) => pendingEntry !== entry)
    pendingTerminalStatus = undefined
  }

  /**
   * Resolves `false` on every failure and never rejects, so a detached flush
   * cannot surface as an unhandled rejection. Callers keep their own guards as
   * defence in depth for that invariant.
   */
  const doFlush = async (): Promise<boolean> => {
    if (pending.length === 0) return true
    let batch: ExecutionEventEntry[] = []
    let batchBytes = 0
    try {
      const limits = getRedisBudgetLimits('execution')
      const chunk = takeFlushChunk(limits.maxSingleWriteBytes)
      batch = chunk.entries
      batchBytes = chunk.bytes
      const { zaddArgs } = chunk
      // Only authoritative once the final chunk lands.
      const chunkTerminalStatus = pending.length === 0 ? pendingTerminalStatus : undefined
      const key = getEventsKey(executionId)
      if (batchBytes > limits.maxSingleWriteBytes) {
        // A single entry above the cap can never be written; dropping it is the
        // only way the rest of the buffer makes progress.
        throw new ExecutionResourceLimitError({
          resource: 'redis_key_bytes',
          attemptedBytes: batchBytes,
          limitBytes: limits.maxSingleWriteBytes,
        })
      }
      const budgetKeys = getRedisBudgetKeys({
        kind: 'execution',
        id: executionId,
        userId: context.userId,
      })
      const flushResult = getFlushScriptResult(
        await redis.eval(
          FLUSH_EVENTS_SCRIPT,
          4 + budgetKeys.length,
          key,
          getSeqKey(executionId),
          getMetaKey(executionId),
          getExecutionSignalChannel(executionId),
          ...budgetKeys,
          chunkTerminalStatus ? TERMINAL_TTL_SECONDS : ACTIVE_TTL_SECONDS,
          EVENT_LIMIT,
          new Date().toISOString(),
          chunkTerminalStatus ?? '',
          batchBytes,
          limits.maxOwnerBytes,
          limits.maxUserBytes,
          limits.ttlSeconds,
          ...zaddArgs
        )
      )
      if (!flushResult.allowed) {
        throw new ExecutionResourceLimitError({
          resource:
            flushResult.resource === 'user_redis_bytes'
              ? 'user_redis_bytes'
              : 'execution_redis_bytes',
          attemptedBytes: batchBytes,
          currentBytes: flushResult.currentBytes ?? 0,
          limitBytes:
            flushResult.resource === 'user_redis_bytes'
              ? limits.maxUserBytes
              : limits.maxOwnerBytes,
        })
      }
      consecutiveFlushFailures = 0
      lastResourceLimitError = null
      if (chunkTerminalStatus) pendingTerminalStatus = undefined
      return true
    } catch (error) {
      if (isExecutionResourceLimitError(error)) {
        // Requeueing is what let `pending` grow for a whole run: the batch was
        // restored and retried, each attempt re-serializing an ever-larger array.
        // These bytes cannot be persisted, so drop them and let backoff pace the
        // retries — the budget frees as the ring buffer prunes and as the
        // caller's other executions finish.
        consecutiveFlushFailures += 1
        lastResourceLimitError = error instanceof ExecutionResourceLimitError ? error : null
        logger.warn('Dropped execution events that exceeded the Redis byte budget', {
          executionId,
          droppedEvents: batch.length,
          droppedBytes: batchBytes,
          consecutiveFailures: consecutiveFlushFailures,
          resource: (error as Partial<ExecutionResourceLimitError>).resource,
        })
        return false
      }
      consecutiveFlushFailures += 1
      // Only report a budget rejection when it was the most recent cause; a
      // stale one would surface a Redis outage as a bogus 413.
      lastResourceLimitError = null
      logger.warn('Failed to flush execution events', {
        executionId,
        batchSize: batch.length,
        consecutiveFailures: consecutiveFlushFailures,
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
    if (terminalStatus) pendingTerminalStatus = terminalStatus
    while (true) {
      if (flushPromise) {
        const ok = await flushPromise
        if (!ok) return false
        continue
      }
      if (pending.length === 0) return true

      flushPromise = doFlush()
      let ok = false
      try {
        ok = await flushPromise
      } finally {
        flushPromise = null
      }
      if (!ok) {
        if (scheduleOnFailure && pending.length > 0) scheduleFlush(getFlushDelayMs())
        return false
      }
    }
  }

  /**
   * Compact an event for the buffer, degrading if pressure offloading fails.
   *
   * Offloading under pressure is an optimization: it keeps a heavy run from
   * exhausting its budget. When durable storage rejects the write, losing the
   * event from replay entirely is a worse outcome than carrying it inline, so
   * fall back to the shared cap — exactly what the run would have done before
   * pressure engaged.
   */
  const compactForBuffer = async (event: ExecutionEvent) => {
    const valueThresholdBytes = getValueThresholdBytes()
    const options = { ...context, executionId, requireDurablePayloads: true }
    if (valueThresholdBytes === undefined) return compactEventForBuffer(event, options)
    try {
      return await compactEventForBuffer(event, { ...options, valueThresholdBytes })
    } catch (error) {
      logger.warn('Pressure offload failed; buffering the event inline instead', {
        executionId,
        eventType: event.type,
        error: toError(error).message,
      })
      return compactEventForBuffer(event, options)
    }
  }

  const writeCore = async (event: ExecutionEvent): Promise<ExecutionEventEntry> => {
    if (nextEventId === 0 || nextEventId > maxReservedId) {
      await reserveIds(1)
    }
    const eventId = nextEventId++
    const compactEvent = await compactForBuffer(event)
    const entry: ExecutionEventEntry = { eventId, executionId, event: compactEvent }
    bufferedBytes += getJsonSize(entry) ?? 0
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
      const compactEvent = await compactForBuffer(event)
      const entry: ExecutionEventEntry = { eventId, executionId, event: compactEvent }
      bufferedBytes += getJsonSize(entry) ?? 0
      pending.push(entry)
      let ok = false
      try {
        ok = await flushPending(false, status)
        if (!ok && lastResourceLimitError && pendingTerminalStatus) {
          // The batch carrying the terminal event exceeded the budget and was
          // dropped. Those bytes are gone either way, and the terminal event is
          // small enough to plausibly fit on its own — so give it one attempt
          // alone rather than losing the run's final status with them. Gated on a
          // budget rejection specifically: a transient Redis error leaves the batch
          // queued for retry, and clearing it here would turn that into data loss.
          const terminalStatus = pendingTerminalStatus
          pending = pending.filter((pendingEntry) => pendingEntry !== entry)
          if (pending.length > 0) {
            // Drain what is queued ahead of the terminal event first, with the
            // status disarmed: `doFlush` stamps it on whichever chunk empties
            // `pending`, so leaving it armed would mark the run complete before
            // its terminal event is written. Whatever this cannot persist stays
            // queued — it must not be overwritten.
            pendingTerminalStatus = undefined
            await flushPending(false)
            pendingTerminalStatus = terminalStatus
          }
          if (pending.length === 0) {
            // Only publish alone once nothing earlier is still queued. Doing so
            // over a surviving backlog would signal end-of-run to a reader that
            // has not received those events; failing instead lets the caller
            // degrade, which records the status without claiming they arrived.
            pending = [entry]
            ok = await flushPending(false)
          }
        }
      } catch (error) {
        discardTerminalEntry(entry)
        throw error
      }
      // `pendingTerminalStatus` still being set means the status never reached
      // Redis even though the events did. Treat it as a failed terminal publish
      // instead of reporting a success that readers cannot observe.
      if (!ok || pendingTerminalStatus) {
        discardTerminalEntry(entry)
        // Report why when the budget was the cause, so the run surfaces the
        // actionable "reduce payload size" message rather than a generic failure.
        throw (
          lastResourceLimitError ??
          new Error(`Failed to flush terminal execution event for ${executionId}`)
        )
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
