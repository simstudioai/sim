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
import { type ChatStreamLease, StreamControllerSupersededError } from './controller-lease'

const logger = createLogger('SessionBuffer')

const STREAM_OUTBOX_PREFIX = 'mothership_stream:'
const DEFAULT_TTL_SECONDS = 60 * 60
/**
 * Floor for a configured live TTL: three of the 20 s chat-lock heartbeats that refresh
 * an idle live buffer, so a parked run cannot expire between refreshes.
 */
const MIN_TTL_SECONDS = 60
const DEFAULT_COMPLETED_TTL_SECONDS = 5 * 60
const DEFAULT_EVENT_LIMIT = 100_000
const RETRY_DELAYS_MS = [0, 50, 150] as const
/**
 * Share of the owner ceiling the replay ring retains before trimming its oldest events.
 * The rest is headroom, so a long run trims instead of being refused.
 */
const RETAINED_BYTES_FRACTION = 0.75
/** Existing ring members read per page while choosing which to trim. */
const TRIM_PAGE_SIZE = 256
/**
 * Most members one append trims for bytes beyond what the count limit requires. A ring
 * already past its byte target (written before byte trimming existed) catches up over
 * several appends instead of in one long script.
 */
const MAX_BYTE_TRIM_MEMBERS = 16 * TRIM_PAGE_SIZE

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

/** Marks a stream whose cleanup is scheduled, so a late heartbeat cannot revive it. */
function getClosedKey(streamId: string) {
  return `${STREAM_OUTBOX_PREFIX}${streamId}:closed`
}

export type StreamConfig = {
  ttlSeconds: number
  eventLimit: number
}

export function getStreamConfig(): StreamConfig {
  return {
    ttlSeconds: Math.max(
      MIN_TTL_SECONDS,
      envNumber(env.COPILOT_STREAM_TTL_SECONDS, DEFAULT_TTL_SECONDS, { min: 1 })
    ),
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
      getClosedKey(streamId),
      ownerBudgetKey
    )
  })
}

/**
 * KEYS: [events, seq, ownerBudget, closed]
 * ARGV: [ttlSeconds, budgetTtlSeconds]
 */
const REFRESH_BUFFER_TTL_SCRIPT = `
if redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[3], ARGV[2])
return 1
`

/**
 * Slides a live stream's replay TTLs, and its byte counter's, without an append. They
 * otherwise move only when an event lands, so a run parked on a long tool call or
 * approval would lose its replay history and restart its numbering while it still
 * runs, or keep its history after the counter that accounts for it expired. A stream
 * whose cleanup is already scheduled is left to expire.
 */
export async function refreshBufferTtl(streamId: string): Promise<void> {
  const { ttlSeconds } = getStreamConfig()
  const [ownerBudgetKey] = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId })
  const budgetTtlSeconds = Math.max(getRedisBudgetLimits('copilot_stream').ttlSeconds, ttlSeconds)
  await withRedisRetry({ operation: 'refresh_outbox_ttl', streamId }, async (redis) => {
    await redis.eval(
      REFRESH_BUFFER_TTL_SCRIPT,
      4,
      getEventsKey(streamId),
      getSeqKey(streamId),
      ownerBudgetKey,
      getClosedKey(streamId),
      ttlSeconds,
      budgetTtlSeconds
    )
  })
}

export async function scheduleBufferCleanup(
  streamId: string,
  ttlSeconds = DEFAULT_COMPLETED_TTL_SECONDS
): Promise<void> {
  try {
    await withRedisRetry({ operation: 'schedule_outbox_cleanup', streamId }, async (redis) => {
      // The marker goes first: a refresh that lands before it is overridden by the
      // expirations below, and one that lands after it sees the marker and does nothing.
      const pipeline = redis.pipeline()
      pipeline.set(getClosedKey(streamId), '1', 'EX', ttlSeconds)
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
 * The ring is a sliding window bounded by count and by bytes: the lowest-ranked
 * members are trimmed until both fit, and exactly the trimmed bytes are refunded.
 * The owner counter is the ring's byte total, so a stream of any length stays under
 * its retained-bytes target and never reaches the owner ceiling. A byte trim drops an
 * incoming member only when a replay reintroduces it below a retained one, which keeps
 * the ring contiguous; it never drops the newest, so a counter already past the
 * ceiling still refuses rather than silently discarding the write.
 *
 * Entries already present are skipped when counting, which makes the script
 * idempotent: `withRedisRetry` may run it up to three times, and a retry after a
 * partial failure must not charge the same bytes twice.
 *
 * KEYS: [events, seq, lease?, budgetOwner, budgetUser?]
 * ARGV: [ttlSeconds, eventLimit, ownerLimit, userLimit, budgetTtlSeconds, lastSeq,
 *        retainedBytesLimit, leaseValue?, score, member, ...]
 * Returns {1} on success, or {0, resource, currentBytes} when the budget refuses.
 */
function appendEventsScript(leased: boolean): string {
  const firstMember = leased ? 9 : 8
  const ownerKey = `KEYS[${leased ? 4 : 3}]`
  return `
${leased ? "if redis.call('GET', KEYS[3]) ~= ARGV[8] then return {-1} end" : ''}
local ttl_seconds = tonumber(ARGV[1])
local event_limit = tonumber(ARGV[2])
local owner_limit = tonumber(ARGV[3])
local user_limit = tonumber(ARGV[4])
local budget_ttl_seconds = tonumber(ARGV[5])
local last_seq = ARGV[6]
local retained_bytes_limit = tonumber(ARGV[7])

local function ranks_before(a, b)
  if a.score == b.score then return a.member < b.member end
  return a.score < b.score
end

local new_count = 0
local new_bytes = 0
local new_members = {}
local seen_members = {}
for i = ${firstMember}, #ARGV, 2 do
  local member = ARGV[i + 1]
  if not seen_members[member] and not redis.call('ZSCORE', KEYS[1], member) then
    seen_members[member] = true
    new_count = new_count + 1
    new_bytes = new_bytes + string.len(member)
    table.insert(new_members, {member = member, score = tonumber(ARGV[i])})
  end
end
table.sort(new_members, ranks_before)

local current_count = redis.call('ZCARD', KEYS[1])
local count_excess = math.max(current_count + new_count - event_limit, 0)
local byte_excess = 0
if retained_bytes_limit > 0 then
  local retained_bytes = tonumber(redis.call('GET', ${ownerKey}) or '0')
  byte_excess = math.max(retained_bytes + new_bytes - retained_bytes_limit, 0)
end

-- Walk the union of the ring and this batch in rank order, paging the ring so a
-- trim reads only as many existing members as it removes.
local prune_count = 0
local pruned_bytes = 0
local next_new = 1
local page = {}
local page_index = 1
local fetched = 0
local max_prune_count = count_excess + ${MAX_BYTE_TRIM_MEMBERS}
while prune_count < count_excess or (pruned_bytes < byte_excess and prune_count < max_prune_count) do
  if page_index > #page and fetched < current_count then
    page = redis.call('ZRANGE', KEYS[1], fetched, fetched + ${TRIM_PAGE_SIZE} - 1, 'WITHSCORES')
    fetched = fetched + #page / 2
    page_index = 1
  end
  local existing = nil
  if page_index <= #page then
    existing = {member = page[page_index], score = tonumber(page[page_index + 1])}
  end
  local incoming = new_members[next_new]
  if incoming and (not existing or ranks_before(incoming, existing)) then
    if not existing and prune_count >= count_excess then break end
    pruned_bytes = pruned_bytes + string.len(incoming.member)
    next_new = next_new + 1
  elseif existing then
    pruned_bytes = pruned_bytes + string.len(existing.member)
    page_index = page_index + 2
  else
    break
  end
  prune_count = prune_count + 1
end

local net_bytes = new_bytes - pruned_bytes
${renderRedisBudgetLua(leased ? 3 : 2)}

for i = ${firstMember}, #ARGV, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
if prune_count > 0 then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, prune_count - 1)
end
redis.call('EXPIRE', KEYS[1], ttl_seconds)
redis.call('SET', KEYS[2], last_seq, 'EX', ttl_seconds)
return {1}
`
}

const APPEND_EVENTS_SCRIPT = appendEventsScript(false)
const LEASED_APPEND_EVENTS_SCRIPT = appendEventsScript(true)

/** What a stream is charged against. `userId` adds the cross-stream user ceiling. */
export interface StreamBudgetScope {
  streamId: string
  userId?: string
}

export type AppendEventsResult =
  | { persisted: true }
  | { persisted: false; refusal: RedisBudgetRefusal }

/**
 * Persists replay events and reports budget refusal without mutating storage.
 * Leased writers require success before delivery; unleased writers may already
 * have delivered the batch and stop recording after a refusal. A stale lease throws.
 */
export async function appendEvents(
  envelopes: PersistedStreamEventEnvelope[],
  scope?: StreamBudgetScope,
  lease?: ChatStreamLease
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
  const retainedBytesLimit = Math.floor(limits.maxOwnerBytes * RETAINED_BYTES_FRACTION)

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
        lease ? LEASED_APPEND_EVENTS_SCRIPT : APPEND_EVENTS_SCRIPT,
        (lease ? 3 : 2) + budgetKeys.length,
        getEventsKey(streamId),
        getSeqKey(streamId),
        ...(lease ? [lease.key] : []),
        ...budgetKeys,
        config.ttlSeconds,
        config.eventLimit,
        limits.maxOwnerBytes,
        limits.maxUserBytes,
        budgetTtlSeconds,
        String(chunk.members[chunk.members.length - 1].seq),
        retainedBytesLimit,
        ...(lease ? [lease.value] : []),
        ...zaddArgs
      )
    )

    if (Array.isArray(result) && result[0] === -1) throw new StreamControllerSupersededError()
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
        detail: parsed.message,
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

/** The streams among these whose replay buffer has not yet expired. */
export async function findStreamsWithReplay(streamIds: string[]): Promise<Set<string>> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Redis is required for mothership stream durability')
  if (streamIds.length === 0) return new Set()
  const pipeline = redis.pipeline()
  for (const streamId of streamIds) pipeline.exists(getSeqKey(streamId))
  const replies = (await pipeline.exec()) ?? []
  const withReplay = new Set<string>()
  streamIds.forEach((streamId, index) => {
    const [error, count] = replies[index] ?? [new Error('Redis returned no reply')]
    if (error) throw error
    if (count === 1) withReplay.add(streamId)
  })
  return withReplay
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
