import { toError } from '@sim/utils/errors'
import { getCreditBalance, getUserUsageData, getUserUsageLimitInfo } from '@/lib/billing'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'

/**
 * Live billing snapshot for the requesting user: plan, current-period usage
 * against its limit, and purchased credit balance. All three sources are
 * org-aware — a member whose subscription lives on an organization gets the
 * org's plan, limit, and credit pool, with `billingScope`/`organizationId`
 * saying which applied.
 */
export async function executeGetAccountBilling(context: ExecutionContext): Promise<ToolCallResult> {
  try {
    const [usage, credits, limitInfo] = await Promise.all([
      getUserUsageData(context.userId),
      getCreditBalance(context.userId),
      getUserUsageLimitInfo(context.userId),
    ])

    return {
      success: true,
      output: {
        plan: limitInfo.plan,
        billingScope: limitInfo.scope,
        organizationId: limitInfo.organizationId,
        usage: {
          currentPeriodCost: usage.currentUsage,
          limit: usage.limit,
          remaining: Math.max(0, usage.limit - usage.currentUsage),
          percentUsed: usage.percentUsed,
          isExceeded: usage.isExceeded,
          billingPeriodEnd: usage.billingPeriodEnd,
        },
        credits: {
          balance: credits.balance,
          scope: credits.entityType,
        },
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
