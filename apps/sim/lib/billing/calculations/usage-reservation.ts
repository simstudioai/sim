import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { getRedisClient } from '@/lib/core/config/redis'
import { getExecutionReservationTtlMs } from '@/lib/core/execution-limits'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'

const logger = createLogger('UsageReservation')

/**
 * Maximum number of simultaneously in-flight (admitted but not-yet-costed)
 * executions a single billing entity may hold at once.
 *
 * The usage-cap admission gate reads already-recorded cost, but cost is only
 * written when an execution finishes. Without a reservation, N parallel
 * executions all read the same pre-burst usage, all pass the cap, and all run —
 * collectively spending far past the cap before any cost lands in the ledger
 * (free-tier abuse / hard-cap defeat). Bounding the number of in-flight
 * executions per billing entity bounds the worst-case overshoot to roughly this
 * many executions' worth of spend.
 */
const MAX_CONCURRENT_EXECUTIONS: Record<SubscriptionPlan, number> = {
  free: 15,
  pro: 75,
  team: 150,
  enterprise: 300,
}

/**
 * Per-slot reserved cost estimate (dollars). The guaranteed-minimum charge
 * every execution incurs, used to taper admission as recorded usage approaches
 * the cap: an entity may hold at most `floor(headroom / estimate)` concurrent
 * slots, keeping `recordedUsage + reservedSlots * estimate <= limit`. A lone
 * execution is never blocked on headroom alone — the recorded-usage gate
 * (`isExceeded`) governs the single-execution case, so the only residual
 * overshoot is the one already inherent to admission (cost is unknown until the
 * execution finishes).
 */
const SLOT_COST_ESTIMATE = BASE_EXECUTION_CHARGE

const INFLIGHT_KEY_PREFIX = 'usage:inflight:'
const POINTER_KEY_PREFIX = 'usage:reservation:'

/**
 * Atomically admit an execution only when both the per-entity concurrency cap
 * and the remaining usage headroom permit it, then record the in-flight slot.
 *
 * Prune expired members (crash safety) -> `count = ZCARD` -> reject when
 * `count >= min(maxConcurrency, max(1, headroomSlots))` -> otherwise `ZADD` the
 * slot, refresh the set TTL, and write the per-execution pointer for release.
 * The `max(1, ...)` floor guarantees a lone execution is never blocked on
 * headroom alone; concurrency above the first slot still tapers with headroom.
 */
const RESERVE_SCRIPT = `
local now = tonumber(ARGV[1])
local expiryScore = tonumber(ARGV[2])
local maxConcurrency = tonumber(ARGV[3])
local headroomSlots = tonumber(ARGV[4])
local pttl = tonumber(ARGV[7])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local count = redis.call('ZCARD', KEYS[1])
if headroomSlots < 1 then headroomSlots = 1 end
local allowed = maxConcurrency
if headroomSlots < allowed then allowed = headroomSlots end
if count >= allowed then
  return 0
end
redis.call('ZADD', KEYS[1], expiryScore, ARGV[5])
redis.call('PEXPIRE', KEYS[1], pttl)
redis.call('SET', KEYS[2], ARGV[6], 'PX', pttl)
return 1
`

/**
 * Stable per-entity reservation key. Org-scoped subscriptions reserve against
 * the organization's pooled cap; everyone else against their personal cap —
 * mirroring the entity the usage limit itself is enforced on.
 */
export function resolveBillingEntityKey(
  userId: string,
  subscription: { referenceId?: string | null } | null | undefined
): string {
  if (isOrgScopedSubscription(subscription, userId) && subscription?.referenceId) {
    return `org:${subscription.referenceId}`
  }
  return `user:${userId}`
}

function getMaxConcurrentExecutions(plan: string | null | undefined): number {
  return MAX_CONCURRENT_EXECUTIONS[getPlanTypeForLimits(plan) as SubscriptionPlan]
}

export interface ReserveExecutionSlotParams {
  userId: string
  executionId: string
  subscription: { plan?: string | null; referenceId?: string | null } | null | undefined
  /** Recorded usage for the billing entity at admission time (dollars). */
  currentUsage: number
  /** The entity's usage cap (dollars). */
  limit: number
}

export interface ReserveExecutionSlotResult {
  reserved: boolean
}

/**
 * Atomic admission reservation that closes the usage-cap check-then-use race.
 *
 * No-ops (admits) when billing enforcement is off or Redis is unavailable —
 * the caller's recorded-usage check still runs in those cases, and failing open
 * here matches the rate limiter rather than turning a Redis blip into a full
 * execution outage.
 */
export async function reserveExecutionSlot(
  params: ReserveExecutionSlotParams
): Promise<ReserveExecutionSlotResult> {
  if (!isBillingEnabled) {
    return { reserved: true }
  }

  const redis = getRedisClient()
  if (!redis) {
    return { reserved: true }
  }

  const { userId, executionId, subscription, currentUsage, limit } = params
  const entityKey = resolveBillingEntityKey(userId, subscription)
  const maxConcurrency = getMaxConcurrentExecutions(subscription?.plan)
  const headroom = Math.max(0, limit - currentUsage)
  const headroomSlots = Math.floor(headroom / SLOT_COST_ESTIMATE)
  const ttlMs = getExecutionReservationTtlMs()
  const now = Date.now()
  const expiryScore = now + ttlMs

  try {
    const result = await redis.eval(
      RESERVE_SCRIPT,
      2,
      `${INFLIGHT_KEY_PREFIX}${entityKey}`,
      `${POINTER_KEY_PREFIX}${executionId}`,
      now.toString(),
      expiryScore.toString(),
      maxConcurrency.toString(),
      headroomSlots.toString(),
      executionId,
      entityKey,
      ttlMs.toString()
    )

    const reserved = result === 1
    if (!reserved) {
      logger.warn('Execution admission throttled — concurrency/usage reservation full', {
        entityKey,
        executionId,
        maxConcurrency,
        headroomSlots,
      })
    }
    return { reserved }
  } catch (error) {
    logger.error('Usage reservation error — failing open (admitting execution)', {
      error: toError(error).message,
      entityKey,
      executionId,
    })
    return { reserved: true }
  }
}

/**
 * Release the in-flight reservation held for an execution. Best-effort and
 * idempotent — safe to call for executions that never reserved (Redis down,
 * billing disabled) or are released more than once. Must NOT be called for a
 * paused execution that may still resume.
 *
 * Uses discrete single-key commands rather than a Lua script that rebuilds the
 * in-flight key from the pointer value: the entity that owns the slot is only
 * known after reading the pointer, and constructing a key inside Lua bypasses
 * the `KEYS` declaration that Redis Cluster relies on for slot routing.
 */
export async function releaseExecutionSlot(executionId: string): Promise<void> {
  if (!isBillingEnabled) {
    return
  }

  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    const pointerKey = `${POINTER_KEY_PREFIX}${executionId}`
    const entityKey = await redis.getdel(pointerKey)
    if (entityKey) {
      await redis.zrem(`${INFLIGHT_KEY_PREFIX}${entityKey}`, executionId)
    }
  } catch (error) {
    logger.warn('Failed to release usage reservation', {
      error: toError(error).message,
      executionId,
    })
  }
}
