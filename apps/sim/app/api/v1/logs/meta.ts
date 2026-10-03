import { buildRateLimitHeaders } from '@/lib/api/server/rate-limit-context'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getEffectiveCurrentPeriodCost } from '@/lib/billing/core/usage'
import { RateLimiter } from '@/lib/core/rate-limiter'
import type { LogFieldProjection } from '@/lib/logs/log-projection'

export interface UserLimits {
  workflowExecutionRateLimit: {
    sync: {
      requestsPerMinute: number
      maxBurst: number
      remaining: number
      resetAt: string
    }
    async: {
      requestsPerMinute: number
      maxBurst: number
      remaining: number
      resetAt: string
    }
  }
  usage: {
    /** `null` when the caller's permission group withholds spend — see {@link projectUserLimits}. */
    currentPeriodCost: number | null
    limit: number
    plan: string
    isExceeded: boolean
  }
}

export async function getUserLimits(userId: string): Promise<UserLimits> {
  const [userSubscription, usageCheck, effectiveCost, rateLimiter] = await Promise.all([
    getHighestPrioritySubscription(userId),
    checkServerSideUsageLimits(userId),
    getEffectiveCurrentPeriodCost(userId),
    Promise.resolve(new RateLimiter()),
  ])

  const [syncStatus, asyncStatus] = await Promise.all([
    rateLimiter.getRateLimitStatusWithSubscription(userId, userSubscription, 'api', false),
    rateLimiter.getRateLimitStatusWithSubscription(userId, userSubscription, 'api', true),
  ])

  return {
    workflowExecutionRateLimit: {
      sync: {
        requestsPerMinute: syncStatus.requestsPerMinute,
        maxBurst: syncStatus.maxBurst,
        remaining: syncStatus.remaining,
        resetAt: syncStatus.resetAt.toISOString(),
      },
      async: {
        requestsPerMinute: asyncStatus.requestsPerMinute,
        maxBurst: asyncStatus.maxBurst,
        remaining: asyncStatus.remaining,
        resetAt: asyncStatus.resetAt.toISOString(),
      },
    },
    usage: {
      currentPeriodCost: effectiveCost,
      limit: usageCheck.limit,
      plan: userSubscription?.plan || 'free',
      isExceeded: usageCheck.isExceeded,
    },
  }
}

/**
 * Withholds the caller's period spend from the `limits` envelope when their
 * permission group withholds `logs.cost`.
 *
 * `hideCostInfo` withholds cost and token spend, and on a personal key the
 * keyholder IS the governed member: blanking every run's `cost` while the same
 * response reports what those runs added up to this period withholds nothing.
 * A workspace key resolves no group at all (`resolveLogFieldProjection` returns
 * the empty projection for it), so a shared credential still reports the billed
 * account's usage.
 *
 * `limit`, `plan` and `isExceeded` stay: they are the caller's entitlement and
 * their own execution eligibility — the reason a run would be refused — not a
 * spend figure.
 *
 * permission-group-enforced: logs.cost
 */
export function projectUserLimits(limits: UserLimits, projection: LogFieldProjection): UserLimits {
  if (!projection.hideCostInfo) return limits
  return { ...limits, usage: { ...limits.usage, currentPeriodCost: null } }
}

export function createApiResponse<T>(
  data: T,
  limits: UserLimits,
  apiRateLimit: { limit: number; remaining: number; resetAt: Date }
) {
  return {
    body: {
      ...data,
      limits,
    },
    headers: {
      ...buildRateLimitHeaders(apiRateLimit),
    },
  }
}
