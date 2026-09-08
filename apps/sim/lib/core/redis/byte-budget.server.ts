import type { Logger } from '@sim/logger'

/**
 * Per-owner byte accounting for shared Redis.
 *
 * Redis has no per-tenant memory limit — the documented way to get one is to meter
 * in the application, which is what this does. It is the generalization of the
 * budget the execution event buffer has enforced since it was written, which the
 * copilot stream buffer now shares rather than inventing a bound of its own.
 *
 * A quota is the right bound for a buffer whose contents must stay contiguous: the
 * copilot replay chain and an execution's event history are read from a cursor, so
 * the write that would breach the ceiling is refused and the buffer stops growing.
 * A live-update feed is bounded differently — see `lib/realtime/event-log.ts`, whose
 * readers already handle a prune by refetching, so it drops oldest-first instead.
 *
 * The unit is bytes, deliberately. An entry cap bounds cardinality and says nothing
 * about size, so a key holding a few hundred entries of a few hundred KB passes an
 * entry cap of any value while holding hundreds of megabytes. That is how a copilot
 * file-edit stream reached gigabytes under a 100,000-entry cap.
 *
 * Values too large to store belong in blob storage behind a reference — see
 * `lib/execution/payloads/large-value-ref.ts`. This module is the other half: it
 * bounds the aggregate once each value is already small enough to keep.
 */

/**
 * Historical prefix, kept verbatim.
 *
 * It reads as execution-scoped because executions were the first owner. Renaming it
 * would orphan every counter in flight at deploy for no behavioural gain, and the
 * kind segment below already disambiguates.
 */
const REDIS_BUDGET_PREFIX = 'execution:redis-budget:'

/** What a budget is charged to. One counter per owner, plus one per user across owners. */
export type RedisBudgetOwnerKind = 'execution' | 'copilot_stream'

export interface RedisBudgetScope {
  kind: RedisBudgetOwnerKind
  /** The owner's id — an execution id, a stream id, a table id. */
  id: string
  /**
   * Charges the write to a second, user-wide counter as well. Omitted where the
   * writer has no user in scope; the owner counter still applies.
   */
  userId?: string
}

export interface RedisBudgetLimits {
  maxSingleWriteBytes: number
  maxOwnerBytes: number
  maxUserBytes: number
  ttlSeconds: number
}

/**
 * Window applied to both counters, extended differently on purpose.
 *
 * An owner counter accounts for data refreshed on the same schedule as the counter
 * itself, so sliding its TTL on every write keeps the counter and the bytes it
 * represents in step.
 *
 * A user counter aggregates across every owner that user writes to. Sliding it on
 * each write would keep it alive indefinitely for anyone who stays active while the
 * data underneath it keeps expiring — so the counter would accrue bytes Redis has
 * already dropped and eventually pin the user at their ceiling until they went a full
 * window without writing. User counters therefore get a fixed window: set on
 * creation, never extended.
 */
const REDIS_BUDGET_TTL_SECONDS = 60 * 60

const LIMITS: Record<RedisBudgetOwnerKind, Omit<RedisBudgetLimits, 'ttlSeconds'>> = {
  /** Unchanged from what the execution event buffer has always enforced. */
  execution: {
    maxSingleWriteBytes: 8 * 1024 * 1024,
    maxOwnerBytes: 64 * 1024 * 1024,
    maxUserBytes: 256 * 1024 * 1024,
  },
  /**
   * A copilot turn streams text and tool frames, not payloads — a single frame past
   * 1 MB is already pathological. The owner ceiling is what a long agentic session
   * may retain for replay across its whole hour.
   */
  copilot_stream: {
    maxSingleWriteBytes: 1 * 1024 * 1024,
    maxOwnerBytes: 32 * 1024 * 1024,
    maxUserBytes: 128 * 1024 * 1024,
  },
}

export function getRedisBudgetLimits(kind: RedisBudgetOwnerKind): RedisBudgetLimits {
  return { ...LIMITS[kind], ttlSeconds: REDIS_BUDGET_TTL_SECONDS }
}

/**
 * The counter keys a write is charged to, owner first.
 *
 * Callers append these to their script's `KEYS` **last** and pass the number of keys
 * that precede them, which is what lets {@link renderRedisBudgetLua} address them
 * without every script agreeing on a fixed layout.
 */
export function getRedisBudgetKeys(scope: RedisBudgetScope): string[] {
  const keys = [`${REDIS_BUDGET_PREFIX}${scope.kind}:${scope.id}`]
  if (scope.userId) {
    keys.push(`${REDIS_BUDGET_PREFIX}user:${scope.userId}`)
  }
  return keys
}

export interface RedisBudgetRefusal {
  resource: 'owner_redis_bytes' | 'user_redis_bytes'
  currentBytes: number
  limitBytes: number
  attemptedBytes: number
}

/**
 * Lua that reserves or releases `net_bytes` against the caller's budget keys.
 *
 * Rendered into the caller's own script so the reservation and the write it pays for
 * commit together — a budget checked in a separate round trip is a budget two
 * concurrent writers can both pass.
 *
 * Contract for the caller's script:
 * - budget keys are the **last** one or two entries of `KEYS`, in the order
 *   {@link getRedisBudgetKeys} returns them
 * - `baseKeyCount` is how many keys precede them
 * - before including this fragment, define `net_bytes` (may be negative, for bytes
 *   the same write releases by trimming), `owner_limit`, `user_limit` and
 *   `budget_ttl_seconds`
 * - on refusal the fragment `return`s, so include it before the write it guards
 */
export function renderRedisBudgetLua(baseKeyCount: number): string {
  const ownerKey = `KEYS[${baseKeyCount + 1}]`
  const userKey = `KEYS[${baseKeyCount + 2}]`
  const hasUserKey = `#KEYS >= ${baseKeyCount + 2}`

  return `
if net_bytes > 0 then
  local owner_current = tonumber(redis.call('GET', ${ownerKey}) or '0')
  if owner_limit > 0 and owner_current + net_bytes > owner_limit then
    return {0, 'owner_redis_bytes', owner_current}
  end
  if ${hasUserKey} then
    local user_current = tonumber(redis.call('GET', ${userKey}) or '0')
    if user_limit > 0 and user_current + net_bytes > user_limit then
      return {0, 'user_redis_bytes', user_current}
    end
  end
  redis.call('INCRBY', ${ownerKey}, net_bytes)
  redis.call('EXPIRE', ${ownerKey}, budget_ttl_seconds)
  if ${hasUserKey} then
    redis.call('INCRBY', ${userKey}, net_bytes)
    if redis.call('TTL', ${userKey}) < 0 then
      redis.call('EXPIRE', ${userKey}, budget_ttl_seconds)
    end
  end
elseif net_bytes < 0 then
  local release_bytes = -net_bytes
  local owner_next = redis.call('DECRBY', ${ownerKey}, release_bytes)
  if owner_next <= 0 then
    redis.call('DEL', ${ownerKey})
  else
    redis.call('EXPIRE', ${ownerKey}, budget_ttl_seconds)
  end
  if ${hasUserKey} then
    local user_next = redis.call('DECRBY', ${userKey}, release_bytes)
    if user_next <= 0 then
      redis.call('DEL', ${userKey})
    elseif redis.call('TTL', ${userKey}) < 0 then
      redis.call('EXPIRE', ${userKey}, budget_ttl_seconds)
    end
  end
else
  if redis.call('EXISTS', ${ownerKey}) == 1 then
    redis.call('EXPIRE', ${ownerKey}, budget_ttl_seconds)
  end
  if ${hasUserKey} and redis.call('EXISTS', ${userKey}) == 1 and redis.call('TTL', ${userKey}) < 0 then
    redis.call('EXPIRE', ${userKey}, budget_ttl_seconds)
  end
end
`
}

/** Parses the `{0, resource, current}` refusal a guarded script returns. */
export function parseRedisBudgetRefusal(
  result: unknown,
  attemptedBytes: number,
  limits: RedisBudgetLimits
): RedisBudgetRefusal | null {
  if (!Array.isArray(result) || result[0] !== 0) return null
  const resource = result[1] === 'user_redis_bytes' ? 'user_redis_bytes' : 'owner_redis_bytes'
  return {
    resource,
    currentBytes: Number(result[2] ?? 0),
    limitBytes: resource === 'user_redis_bytes' ? limits.maxUserBytes : limits.maxOwnerBytes,
    attemptedBytes,
  }
}

export interface RedisBudgetLogContext {
  operation: string
  scope: RedisBudgetScope
  logger?: Logger
}

/** One place that decides how a refusal is reported, so every writer reports it alike. */
export function logRedisBudgetRefusal(
  refusal: RedisBudgetRefusal,
  context: RedisBudgetLogContext
): void {
  context.logger?.warn('Redis byte budget refused a write', {
    operation: context.operation,
    ownerKind: context.scope.kind,
    ownerId: context.scope.id,
    resource: refusal.resource,
    attemptedBytes: refusal.attemptedBytes,
    currentBytes: refusal.currentBytes,
    limitBytes: refusal.limitBytes,
  })
}
