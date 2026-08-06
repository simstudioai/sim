import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2BillingStatusData,
  v2GetBillingStatusContract,
} from '@/lib/api/contracts/v2/billing'
import { parseRequest } from '@/lib/api/server'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'
import {
  checkAttributedBillingBlocks,
  resolveBillingAttribution,
  toUsageLimitSubscription,
} from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { deriveBillingContext } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2BillingStatusAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Current billing standing; ledger events are exposed separately by `/billing/logs`. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'billing-usage')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2GetBillingStatusContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const workspaceFilter = await v2BillingWorkspaceFilter(rateLimit, parsed.data.query.workspaceId)
    if (!workspaceFilter.ok) return workspaceFilter.response

    let data: V2BillingStatusData
    if (workspaceFilter.workspaceId) {
      const attribution = await resolveBillingAttribution({
        actorUserId: userId,
        workspaceId: workspaceFilter.workspaceId,
      })
      const [usage, block] = await Promise.all([
        checkUsageStatus(attribution.billedAccountUserId, toUsageLimitSubscription(attribution)),
        checkAttributedBillingBlocks(attribution),
      ])
      data = {
        workspaceId: workspaceFilter.workspaceId,
        period: attribution.billingPeriod,
        plan: attribution.payerSubscription?.plan ?? 'free',
        status: block.blocked ? 'billing_blocked' : usage.isExceeded ? 'limit_exceeded' : 'active',
        credits: {
          used: dollarsToCredits(usage.currentUsage),
          limit: dollarsToCredits(usage.limit),
          remaining: dollarsToCredits(usage.limit - usage.currentUsage),
        },
      }
    } else {
      const subscription = await getHighestPrioritySubscription(userId)
      const { billingEntity, billingPeriod } = deriveBillingContext(userId, subscription)
      const [usage, actorBlock, payerBlock] = await Promise.all([
        checkUsageStatus(userId, subscription),
        checkBillingBlocked(userId),
        billingEntity.type === 'user' && billingEntity.id === userId
          ? Promise.resolve({ blocked: false })
          : checkBillingEntityBlocked(billingEntity),
      ])
      data = {
        workspaceId: null,
        period: {
          start: billingPeriod.start.toISOString(),
          end: billingPeriod.end.toISOString(),
        },
        plan: subscription?.plan ?? 'free',
        status:
          actorBlock.blocked || payerBlock.blocked
            ? 'billing_blocked'
            : usage.isExceeded
              ? 'limit_exceeded'
              : 'active',
        credits: {
          used: dollarsToCredits(usage.currentUsage),
          limit: dollarsToCredits(usage.limit),
          remaining: dollarsToCredits(usage.limit - usage.currentUsage),
        },
      }
    }

    return v2Data(data, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error building billing status`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
