import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getEffectiveCurrentPeriodCost } from '@/lib/billing/core/usage'
import { RateLimiter } from '@/lib/core/rate-limiter'

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
    currentPeriodCost: number
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
      'X-RateLimit-Limit': apiRateLimit.limit.toString(),
      'X-RateLimit-Remaining': apiRateLimit.remaining.toString(),
      'X-RateLimit-Reset': apiRateLimit.resetAt.toISOString(),
    },
  }
}
