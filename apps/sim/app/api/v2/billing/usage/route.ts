import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { type V2UsageSummaryData, v2GetUsageSummaryContract } from '@/lib/api/contracts/v2/billing'
import { parseRequest } from '@/lib/api/server'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { deriveBillingContext, getUserUsageLogs } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2BillingUsageAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/billing/usage — Current-billing-period usage summary with the
 * per-source credit breakdown, for external monitoring (e.g. alerting on
 * Copilot consumption before an overage). Credits only — dollar costs and
 * rate-limit internals are not part of this surface.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'billing-usage')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2GetUsageSummaryContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const workspaceFilter = v2BillingWorkspaceFilter(rateLimit, parsed.data.query.workspaceId)
    if (!workspaceFilter.ok) return workspaceFilter.response

    const subscription = await getHighestPrioritySubscription(userId)
    const { billingPeriod } = deriveBillingContext(userId, subscription)

    const [usageCheck, ledger] = await Promise.all([
      checkServerSideUsageLimits(userId, subscription),
      getUserUsageLogs(userId, {
        workspaceId: workspaceFilter.workspaceId,
        startDate: billingPeriod.start,
        endDate: billingPeriod.end,
        limit: 1,
        includeSummary: true,
      }),
    ])

    const bySourceCredits = Object.fromEntries(
      Object.entries(ledger.summary.bySource).map(([source, cost]) => [
        source,
        dollarsToCredits(cost),
      ])
    )

    const data: V2UsageSummaryData = {
      period: {
        start: billingPeriod.start.toISOString(),
        end: billingPeriod.end.toISOString(),
      },
      totalCredits: dollarsToCredits(ledger.summary.totalCost),
      bySourceCredits,
      limitCredits: dollarsToCredits(usageCheck.limit),
      plan: subscription?.plan || 'free',
    }

    return v2Data(data, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error building usage summary`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
