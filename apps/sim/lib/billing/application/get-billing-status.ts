import { defineAuthorizedBillingReadUseCase } from '@/lib/billing/application/authorized-billing-read-use-case'
import { billingOperations } from '@/lib/billing/application/operations'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'
import {
  checkAttributedBillingBlocks,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
  toUsageLimitSubscription,
} from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { deriveBillingContext } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'

export interface GetBillingStatusInput {
  workspaceId?: string
}

export interface BillingStatusResult {
  workspaceId: string | null
  period: { start: string; end: string }
  plan: string
  status: 'active' | 'limit_exceeded' | 'billing_blocked'
  credits: { used: number; limit: number; remaining: number }
}

export const getBillingStatus = defineAuthorizedBillingReadUseCase({
  operation: billingOperations.readStatus,
  requestedWorkspaceId: (input: GetBillingStatusInput) => input.workspaceId,
  execute: async ({ principal, scope }): Promise<BillingStatusResult> => {
    if (scope.kind === 'workspace') {
      const attribution =
        principal.kind === 'personal_api_key'
          ? await resolveBillingAttribution({
              actorUserId: principal.userId,
              workspaceId: scope.workspace.workspaceId,
            })
          : await resolveSystemBillingAttribution(scope.workspace.workspaceId)
      const [usage, block] = await Promise.all([
        checkUsageStatus(attribution.billedAccountUserId, toUsageLimitSubscription(attribution)),
        checkAttributedBillingBlocks(attribution),
      ])
      return {
        workspaceId: scope.workspace.workspaceId,
        period: attribution.billingPeriod,
        plan: attribution.payerSubscription?.plan ?? 'free',
        status: block.blocked ? 'billing_blocked' : usage.isExceeded ? 'limit_exceeded' : 'active',
        credits: {
          used: dollarsToCredits(usage.currentUsage),
          limit: dollarsToCredits(usage.limit),
          remaining: dollarsToCredits(usage.limit - usage.currentUsage),
        },
      }
    }

    const subscription = await getHighestPrioritySubscription(scope.userId)
    const { billingEntity, billingPeriod } = deriveBillingContext(scope.userId, subscription)
    const [usage, actorBlock, payerBlock] = await Promise.all([
      checkUsageStatus(scope.userId, subscription),
      checkBillingBlocked(scope.userId),
      billingEntity.type === 'user' && billingEntity.id === scope.userId
        ? Promise.resolve({ blocked: false })
        : checkBillingEntityBlocked(billingEntity),
    ])
    return {
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
  },
})
