import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getEffectiveCurrentPeriodCost } from '@/lib/billing/core/usage'
import { RateLimiter } from '@/services/queue'

export interface UserLimits {
  workflowExecutionRateLimit: {
    sync: {
      limit: number
      remaining: number
      resetAt: string
    }
    async: {
      limit: number
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
        limit: syncStatus.limit,
        remaining: syncStatus.remaining,
        resetAt: syncStatus.resetAt.toISOString(),
      },
      async: {
        limit: asyncStatus.limit,
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
