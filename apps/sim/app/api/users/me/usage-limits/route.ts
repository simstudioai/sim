import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getEffectiveCurrentPeriodCost } from '@/lib/billing/core/usage'
import { getUserStorageLimit, getUserStorageUsage } from '@/lib/billing/storage'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('UsageLimitsAPI')

export async function GET(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createErrorResponse('Authentication required', 401)
    }
    const authenticatedUserId = auth.userId

    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)
    const rateLimiter = new RateLimiter()
    const triggerType = auth.authType === 'api_key' ? 'api' : 'manual'
    const [syncStatus, asyncStatus] = await Promise.all([
      rateLimiter.getRateLimitStatusWithSubscription(
        authenticatedUserId,
        userSubscription,
        triggerType,
        false
      ),
      rateLimiter.getRateLimitStatusWithSubscription(
        authenticatedUserId,
        userSubscription,
        triggerType,
        true
      ),
    ])

    const [usageCheck, effectiveCost, storageUsage, storageLimit] = await Promise.all([
      checkServerSideUsageLimits(authenticatedUserId),
      getEffectiveCurrentPeriodCost(authenticatedUserId),
      getUserStorageUsage(authenticatedUserId),
      getUserStorageLimit(authenticatedUserId),
    ])

    const currentPeriodCost = effectiveCost

    return NextResponse.json({
      success: true,
      rateLimit: {
        sync: {
          isLimited: syncStatus.remaining === 0,
          requestsPerMinute: syncStatus.requestsPerMinute,
          maxBurst: syncStatus.maxBurst,
          remaining: syncStatus.remaining,
          resetAt: syncStatus.resetAt,
        },
        async: {
          isLimited: asyncStatus.remaining === 0,
          requestsPerMinute: asyncStatus.requestsPerMinute,
          maxBurst: asyncStatus.maxBurst,
          remaining: asyncStatus.remaining,
          resetAt: asyncStatus.resetAt,
        },
        authType: triggerType,
      },
      usage: {
        currentPeriodCost,
        limit: usageCheck.limit,
        plan: userSubscription?.plan || 'free',
      },
      storage: {
        usedBytes: storageUsage,
        limitBytes: storageLimit,
        percentUsed: storageLimit > 0 ? (storageUsage / storageLimit) * 100 : 0,
      },
    })
  } catch (error: any) {
    logger.error('Error checking usage limits:', error)
    return createErrorResponse(error.message || 'Failed to check usage limits', 500)
  }
}
