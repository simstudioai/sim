import {
  type V2BillingStatusData,
  v2GetBillingStatusContract,
} from '@/lib/api/contracts/v2/billing'
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
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import { v2Data } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Current billing standing; ledger events are exposed separately by `/billing/logs`. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetBillingStatusContract,
  rateLimitEndpoint: 'billing-usage',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const workspaceFilter = await v2BillingWorkspaceFilter(rateLimit, input.query.workspaceId)
    if (!workspaceFilter.ok) return workspaceFilter.response

    let data: V2BillingStatusData
    if (workspaceFilter.workspaceId) {
      const attribution =
        rateLimit.keyType === 'workspace'
          ? rateLimit.billingAttribution
          : await resolveBillingAttribution({
              actorUserId: userId,
              workspaceId: workspaceFilter.workspaceId,
            })
      if (!attribution || attribution.workspaceId !== workspaceFilter.workspaceId) {
        throw new Error('Workspace API request is missing its billing attribution')
      }
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
  },
})
