import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { env, envNumber } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'
import {
  getRedisBudgetKeys,
  getRedisBudgetLimits,
  logRedisBudgetRefusal,
  parseRedisBudgetRefusal,
  type RedisBudgetRefusal,
  renderRedisBudgetLua,
} from '@/lib/core/redis/byte-budget.server'
import {
  type PersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelopeJson,
} from './contract'

const logger = createLogger('SessionBuffer')

const STREAM_OUTBOX_PREFIX = 'mothership_stream:'
const DEFAULT_TTL_SECONDS = 60 * 60
const DEFAULT_COMPLETED_TTL_SECONDS = 5 * 60
const DEFAULT_EVENT_LIMIT = 100_000
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
    ttlSeconds: envNumber(env.COPILOT_STREAM_TTL_SECONDS, DEFAULT_TTL_SECONDS, { min: 1 }),
    eventLimit: envNumber(env.COPILOT_STREAM_EVENT_LIMIT, DEFAULT_EVENT_LIMIT, { min: 1 }),
  }
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
      await sleep(delay)
    }

    try {
      return await operation(redis)
    } catch (error) {
      lastError = error
      logger.warn('Redis stream operation failed', {
        operation: metadata.operation,
        streamId: metadata.streamId,
        attempt: attempt + 1,
        error: toError(error).message,
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
  await clearBuffer(streamId, 'reset_outbox')
}

export async function clearBuffer(streamId: string, operation = 'clear_outbox'): Promise<void> {
  /*
    The owner counter is deleted WITH the data it accounts for. These keys are deleted rather
    than expired, so a counter left behind would refuse a retry reusing the same streamId
    against bytes that no longer exist; dropping it in a second round trip would be its own
    hole, since a concurrent append landing between the two would keep its events stored with
    its reservation already erased. One variadic DEL is a single atomic command, so no script
    is needed to get that.

    The shared user counter is deliberately untouched: an owner id is not proof of who wrote
    the bytes, so crediting it here would let anyone able to name a stream decrement a ceiling
    they never charged — and a counter driven down grants writes rather than denying them. Its
    fixed window settles it instead, over-counting in the safe direction meanwhile.
  */
  const [ownerBudgetKey] = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId })
  await withRedisRetry({ operation, streamId }, async (redis) => {
    await redis.del(
      getEventsKey(streamId),
      getSeqKey(streamId),
      getAbortKey(streamId),
      ownerBudgetKey
    )
  })
}

export async function scheduleBufferCleanup(
  streamId: string,
  ttlSeconds = DEFAULT_COMPLETED_TTL_SECONDS
): Promise<void> {
  try {
    await withRedisRetry({ operation: 'schedule_outbox_cleanup', streamId }, async (redis) => {
      const pipeline = redis.pipeline()
      pipeline.expire(getEventsKey(streamId), ttlSeconds)
      pipeline.expire(getSeqKey(streamId), ttlSeconds)
      pipeline.expire(getAbortKey(streamId), ttlSeconds)
      await pipeline.exec()
    })
  } catch (error) {
    logger.warn('Failed to shorten stream buffer TTL during cleanup', {
      streamId,
      ttlSeconds,
      error: toError(error).message,
    })
  }
}

/**
 * Appends a batch, trims the ring, refreshes both TTLs and charges the net bytes to
 * the stream's budget — in one script, so the reservation and the write it pays for
 * commit together.
 *
 * Entries already present are skipped when counting, which makes the script
 * idempotent: `withRedisRetry` may run it up to three times, and a retry after a
 * partial failure must not charge the same bytes twice.
 *
 * KEYS: [events, seq, budgetOwner, budgetUser?]
 * ARGV: [ttlSeconds, eventLimit, ownerLimit, userLimit, budgetTtlSeconds, lastSeq,
 *        score, member, ...]
 * Returns {1} on success, or {0, resource, currentBytes} when the budget refuses.
 */
const APPEND_EVENTS_SCRIPT = `
local ttl_seconds = tonumber(ARGV[1])
local event_limit = tonumber(ARGV[2])
local owner_limit = tonumber(ARGV[3])
local user_limit = tonumber(ARGV[4])
local budget_ttl_seconds = tonumber(ARGV[5])
local last_seq = ARGV[6]

local new_count = 0
local new_bytes = 0
local new_members = {}
for i = 7, #ARGV, 2 do
  local member = ARGV[i + 1]
  if not redis.call('ZSCORE', KEYS[1], member) then
    new_count = new_count + 1
    new_bytes = new_bytes + string.len(member)
    table.insert(new_members, member)
  end
end

local current_count = redis.call('ZCARD', KEYS[1])
local prune_count = current_count + new_count - event_limit
if prune_count < 0 then
  prune_count = 0
end
local existing_prune_count = math.min(prune_count, current_count)
local pruned_bytes = 0
if existing_prune_count > 0 then
  local pruned = redis.call('ZRANGE', KEYS[1], 0, existing_prune_count - 1)
  for _, member in ipairs(pruned) do
    pruned_bytes = pruned_bytes + string.len(member)
  end
end
for i = 1, prune_count - existing_prune_count do
  local member = new_members[i]
  if member then
    pruned_bytes = pruned_bytes + string.len(member)
  end
end

local net_bytes = new_bytes - pruned_bytes
${renderRedisBudgetLua(2)}

for i = 7, #ARGV, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -event_limit - 1)
redis.call('EXPIRE', KEYS[1], ttl_seconds)
redis.call('SET', KEYS[2], last_seq, 'EX', ttl_seconds)
return {1}
`

/** What a stream is charged against. `userId` adds the cross-stream user ceiling. */
export interface StreamBudgetScope {
  streamId: string
  userId?: string
}

export type AppendEventsResult =
  | { persisted: true }
  | { persisted: false; refusal: RedisBudgetRefusal }

/**
 * Persists a batch for replay.
 *
 * A refusal is returned, never thrown. A throw here reaches
 * `finalizeStream`'s second flush, which runs inside the error handler and so
 * escapes to reject the response stream — a stream that has already delivered every
 * byte to the user would end in an error because its *replay copy* did not fit.
 * Refusing to persist costs a resume; throwing costs the turn.
 */
export async function appendEvents(
  envelopes: PersistedStreamEventEnvelope[],
  scope?: StreamBudgetScope
): Promise<AppendEventsResult> {
  if (envelopes.length === 0) {
    return { persisted: true }
  }

  const streamId = scope?.streamId ?? envelopes[0].stream.streamId
  const config = getStreamConfig()
  const limits = getRedisBudgetLimits('copilot_stream')
  const budgetScope = {
    kind: 'copilot_stream' as const,
    id: streamId,
    ...(scope?.userId ? { userId: scope.userId } : {}),
  }
  const budgetKeys = getRedisBudgetKeys(budgetScope)
  /*
    A counter must never expire before the data it accounts for: the next write would then
    see zero reserved and let the stream grow by another full ceiling. `COPILOT_STREAM_TTL_SECONDS`
    is configurable and defaults to exactly the budget window, so raising it would otherwise
    break that invariant silently.
  */
  const budgetTtlSeconds = Math.max(limits.ttlSeconds, config.ttlSeconds)

  /*
    Redis measures a member in UTF-8 bytes, so the ceiling has to be measured the same
    way — `String.length` counts UTF-16 units and under-reports every non-ASCII frame,
    which would let a batch past a check the Lua then applies differently.
  */
  const members = envelopes.map((envelope) => {
    const member = JSON.stringify(envelope)
    return { seq: envelope.seq, member, bytes: Buffer.byteLength(member, 'utf8') }
  })

  /*
    Split on the per-write ceiling rather than refusing the whole batch: a flush carries
    whatever accumulated since the last one, so an ordinary run of large frames can exceed
    the ceiling collectively while every frame is individually writable. Refusing that
    batch would stop replay persistence for the rest of the stream over a batching
    artefact. Chunks are written in sequence order, so the stored cursor stays monotonic.
  */
  const chunks: Array<{ members: typeof members; bytes: number }> = []
  for (const entry of members) {
    const last = chunks[chunks.length - 1]
    if (!last || last.bytes + entry.bytes > limits.maxSingleWriteBytes) {
      chunks.push({ members: [entry], bytes: entry.bytes })
    } else {
      last.members.push(entry)
      last.bytes += entry.bytes
    }
  }

  for (const chunk of chunks) {
    /*
      A single frame past the ceiling can never land, and retrying it would stall every
      later batch behind it. Refuse it the same way the budget would.
    */
    if (chunk.bytes > limits.maxSingleWriteBytes) {
      const refusal: RedisBudgetRefusal = {
        resource: 'owner_redis_bytes',
        currentBytes: 0,
        limitBytes: limits.maxSingleWriteBytes,
        attemptedBytes: chunk.bytes,
      }
      logRedisBudgetRefusal(refusal, { operation: 'append_event', scope: budgetScope, logger })
      return { persisted: false, refusal }
    }

    const zaddArgs: Array<number | string> = []
    for (const entry of chunk.members) {
      zaddArgs.push(entry.seq, entry.member)
    }

    const result = await withRedisRetry({ operation: 'append_event', streamId }, async (redis) =>
      redis.eval(
        APPEND_EVENTS_SCRIPT,
        2 + budgetKeys.length,
        getEventsKey(streamId),
        getSeqKey(streamId),
        ...budgetKeys,
        config.ttlSeconds,
        config.eventLimit,
        limits.maxOwnerBytes,
        limits.maxUserBytes,
        budgetTtlSeconds,
        String(chunk.members[chunk.members.length - 1].seq),
        ...zaddArgs
      )
    )

    const refusal = parseRedisBudgetRefusal(result, chunk.bytes, limits)
    if (refusal) {
      logRedisBudgetRefusal(refusal, { operation: 'append_event', scope: budgetScope, logger })
      return { persisted: false, refusal }
    }
  }

  return { persisted: true }
}

export async function appendEvent(
  envelope: PersistedStreamEventEnvelope,
  scope?: StreamBudgetScope
): Promise<PersistedStreamEventEnvelope> {
  await appendEvents([envelope], scope)
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
): Promise<PersistedStreamEventEnvelope[]> {
  const afterSeq = Number(afterCursor || '0')
  if (!Number.isFinite(afterSeq)) {
    throw new InvalidCursorError(streamId, afterCursor)
  }
  const minScore = afterSeq + 1

  const rawEntries = await withRedisRetry({ operation: 'read_events', streamId }, async (redis) => {
    return redis.zrangebyscore(getEventsKey(streamId), minScore, '+inf')
  })

  const envelopes: PersistedStreamEventEnvelope[] = []
  for (const entry of rawEntries) {
    const parsed = parsePersistedStreamEventEnvelopeJson(entry)
    if (!parsed.ok) {
      logger.warn('Skipping corrupt outbox entry', {
        streamId,
        reason: parsed.reason,
        message: parsed.message,
        errors: parsed.errors,
      })
      continue
    }
    envelopes.push(parsed.event)
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
