import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { usageLimitsRequestSchema } from '@/lib/api/contracts/usage-limits'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getUserStorageLimit, getUserStorageUsage } from '@/lib/billing/storage'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('UsageLimitsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  usageLimitsRequestSchema.parse({})

  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createErrorResponse('Authentication required', 401)
    }
    const authenticatedUserId = auth.userId

    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)

    const [usageCheck, storageUsage, storageLimit] = await Promise.all([
      checkServerSideUsageLimits(authenticatedUserId),
      getUserStorageUsage(authenticatedUserId),
      getUserStorageLimit(authenticatedUserId),
    ])

    // Same computation as `limit` (one source, one tier) — the pair can never
    // disagree under replication lag or mixed baseline/ledger tiers.
    const currentPeriodCost = usageCheck.currentUsage

    return NextResponse.json({
      success: true,
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
  } catch (error) {
    logger.error('Error checking usage limits:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to check usage limits'), 500)
  }
})
