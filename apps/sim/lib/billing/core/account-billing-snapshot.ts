import { db } from '@sim/db'
import { getResolvedUserUsageData } from '@/lib/billing/core/usage'
import { getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import type { DbClient } from '@/lib/db/types'

export interface AccountBillingSnapshot {
  plan: string
  billingScope: 'user' | 'organization'
  organizationId: string | null
  usage: {
    currentPeriodCost: number
    limit: number
    remaining: number
    percentUsed: number
    isExceeded: boolean
    billingPeriodEnd: Date | null
  }
  credits: {
    balance: number
    scope: 'user' | 'organization'
  }
}

/** Resolves one coherent subscription, usage, limit, and credit snapshot for an account. */
export async function getAccountBillingSnapshot(
  userId: string,
  executor: DbClient = db
): Promise<AccountBillingSnapshot> {
  const { usage, subscription, personalCreditBalance } = await getResolvedUserUsageData(
    userId,
    executor
  )
  const organizationScoped = isOrgScopedSubscription(subscription, userId) && subscription !== null
  const billingScope = organizationScoped ? 'organization' : 'user'
  const billingEntityId = organizationScoped ? subscription.referenceId : userId
  const creditBalance = organizationScoped
    ? await getCreditBalanceForEntity('organization', billingEntityId, executor)
    : personalCreditBalance

  return {
    plan: subscription?.plan || 'free',
    billingScope,
    organizationId: organizationScoped ? subscription.referenceId : null,
    usage: {
      currentPeriodCost: usage.currentUsage,
      limit: usage.limit,
      remaining: Math.max(0, usage.limit - usage.currentUsage),
      percentUsed: usage.percentUsed,
      isExceeded: usage.isExceeded,
      billingPeriodEnd: usage.billingPeriodEnd,
    },
    credits: {
      balance: creditBalance,
      scope: billingScope,
    },
  }
}
