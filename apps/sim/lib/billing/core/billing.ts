import { db } from '@sim/db'
import { organization, subscription } from '@sim/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  getBillingInterval,
  getHighestPrioritySubscription,
  type SubscriptionMetadata,
} from '@/lib/billing/core/subscription'
import { getOrgUsageLimit, getUserUsageData } from '@/lib/billing/core/usage'
import { getCreditBalance, getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import {
  calculateCurrentLedgerUsageForSubscription,
  calculateCurrentLedgerUsageForUser,
} from '@/lib/billing/ledger/usage-ledger'
import { isEnterprise, isPaid, isPro, isTeam } from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getFreeTierLimit,
  getPlanPricing,
  hasPaidSubscriptionStatus,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'

export { getPlanPricing }

import { createLogger } from '@sim/logger'

const logger = createLogger('Billing')

/**
 * Get the organization's subscription row when its status is one of
 * `ENTITLED_SUBSCRIPTION_STATUSES` (includes `past_due`). Use this
 * when making billing-side decisions (overage math, limit reads,
 * webhooks) where `past_due` still counts as an active paid tenant.
 * For product-access gating use `getOrganizationSubscriptionUsable`
 * (from `core/subscription.ts`), which excludes `past_due`.
 * Returns `null` when there is no entitled sub.
 */
export async function getOrganizationSubscription(organizationId: string) {
  try {
    const orgSubs = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .orderBy(desc(subscription.periodStart), desc(subscription.id))
      .limit(1)

    return orgSubs.length > 0 ? orgSubs[0] : null
  } catch (error) {
    logger.error('Error getting organization subscription', { error, organizationId })
    return null
  }
}

/**
 * BILLING MODEL:
 * 1. User purchases $20 Pro plan → Gets charged $20 immediately via Stripe subscription
 * 2. User uses $15 during the month → No additional charge (covered by $20)
 * 3. User uses $35 during the month → Gets charged $15 overage at month end
 * 4. Usage resets, next month they pay $20 again + any overages
 */

/**
 * Check if a subscription is scoped to an organization by looking up its
 * `referenceId` in the organization table. This is the authoritative
 * answer — the plan name alone is unreliable because `pro_*` plans can be
 * attached to organizations (and we should treat them as org-scoped).
 *
 * Use this in server contexts (webhooks, jobs) where we only have the
 * subscription row, not a user perspective. If you do have a user id,
 * `isOrgScopedSubscription(sub, userId)` is cheaper and equally correct.
 */
export async function isSubscriptionOrgScoped(sub: { referenceId: string }): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, sub.referenceId))
    .limit(1)
  return rows.length > 0
}

/**
 * Aggregate raw pooled stats for all members of an organization in a single
 * query. Used by org-scoped summary and overage calculations so we don't
 * call `getUserUsageData` per-member — that helper now returns the entire
 * pool for org-scoped subs, which would N-times-count the usage.
 *
 * Current usage and copilot spend come from usage_log so billing display
 * follows the same attribution model as threshold/final claims.
 */
async function aggregateOrgMemberStats(
  organizationId: string,
  sub?: {
    id: string
    plan: string | null
    referenceId: string
    seats?: number | null
    periodStart?: Date | null
    periodEnd?: Date | null
  }
): Promise<{
  memberIds: string[]
  currentPeriodCost: number
  effectiveCurrentPeriodCost: number
  currentPeriodCopilotCost: number
  lastPeriodCost: number
  lastPeriodCopilotCost: number
}> {
  const ledgerUsage = sub
    ? await calculateCurrentLedgerUsageForSubscription({
        ...sub,
        referenceId: organizationId,
      })
    : await calculateCurrentLedgerUsageForSubscription({
        id: `org:${organizationId}`,
        plan: null,
        referenceId: organizationId,
        seats: 1,
      })

  const currentPeriodCopilotCost =
    (ledgerUsage.sourceTotals.copilot ?? 0) + (ledgerUsage.sourceTotals.mcp_copilot ?? 0)
  let lastPeriodCost = 0
  let lastPeriodCopilotCost = 0
  if (sub?.periodStart && sub.periodEnd) {
    const periodMs = sub.periodEnd.getTime() - sub.periodStart.getTime()
    if (periodMs > 0) {
      const lastPeriodUsage = await calculateCurrentLedgerUsageForSubscription(
        {
          ...sub,
          referenceId: organizationId,
        },
        db,
        {
          periodStart: new Date(sub.periodStart.getTime() - periodMs),
          periodEnd: sub.periodStart,
        }
      )
      lastPeriodCost = lastPeriodUsage.grossUsage
      lastPeriodCopilotCost =
        (lastPeriodUsage.sourceTotals.copilot ?? 0) +
        (lastPeriodUsage.sourceTotals.mcp_copilot ?? 0)
    }
  }

  return {
    memberIds: ledgerUsage.memberIds,
    currentPeriodCost: ledgerUsage.grossUsage,
    effectiveCurrentPeriodCost: ledgerUsage.effectiveUsage,
    currentPeriodCopilotCost,
    lastPeriodCost,
    lastPeriodCopilotCost,
  }
}

/**
 * Get comprehensive billing and subscription summary
 */
export async function getSimplifiedBillingSummary(
  userId: string,
  organizationId?: string
): Promise<{
  type: 'individual' | 'organization'
  plan: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  creditBalance: number
  billingInterval: 'month' | 'year'
  // Subscription details
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  /** True when the subscription's `referenceId` is an organization id. */
  isOrgScoped: boolean
  /** Present when `isOrgScoped` is true. */
  organizationId: string | null
  status: string | null
  seats: number | null
  metadata: any
  stripeSubscriptionId: string | null
  periodEnd: Date | string | null
  cancelAtPeriodEnd?: boolean
  // Usage details
  usage: {
    current: number
    limit: number
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
    lastPeriodCost: number
    lastPeriodCopilotCost: number
    daysRemaining: number
    copilotCost: number
  }
}> {
  try {
    // Get subscription and usage data upfront
    const [subscription, usageData] = await Promise.all([
      organizationId
        ? getOrganizationSubscription(organizationId)
        : getHighestPrioritySubscription(userId),
      getUserUsageData(userId),
    ])

    const plan = subscription?.plan || 'free'
    const hasPaidEntitlement = hasPaidSubscriptionStatus(subscription?.status)
    const planIsPaid = hasPaidEntitlement && isPaid(plan)
    const planIsPro = hasPaidEntitlement && isPro(plan)
    const planIsTeam = hasPaidEntitlement && isTeam(plan)
    const planIsEnterprise = hasPaidEntitlement && isEnterprise(plan)
    const orgScoped = isOrgScopedSubscription(subscription, userId)
    const subscriptionOrgId = orgScoped && subscription ? subscription.referenceId : null

    if (organizationId) {
      // Organization billing summary
      if (!subscription) {
        return getDefaultBillingSummary('organization')
      }

      // Pool usage/copilot across all members in one query. Must not use
      // `getUserUsageData` per-member — it now returns the pool itself
      // for org-scoped subs, which would N-times-count.
      const pooled = await aggregateOrgMemberStats(organizationId, subscription)

      const rawCurrentUsage = pooled.currentPeriodCost
      const effectiveCurrentUsage = pooled.effectiveCurrentPeriodCost
      const totalCopilotCost = pooled.currentPeriodCopilotCost
      const totalLastPeriodCopilotCost = pooled.lastPeriodCopilotCost

      const { limit: orgUsageLimit } = await getOrgUsageLimit(
        organizationId,
        plan,
        subscription.seats ?? null
      )

      const percentUsed =
        orgUsageLimit > 0 ? Math.round((effectiveCurrentUsage / orgUsageLimit) * 100) : 0
      const isExceeded = effectiveCurrentUsage >= orgUsageLimit
      const isWarning = !isExceeded && percentUsed >= 80

      // Calculate days remaining in billing period
      const daysRemaining = subscription.periodEnd
        ? Math.max(
            0,
            Math.ceil((subscription.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          )
        : 0

      const orgCreditBalance = await getCreditBalanceForEntity('organization', organizationId)
      const orgBillingInterval = getBillingInterval(subscription.metadata as SubscriptionMetadata)

      return {
        type: 'organization',
        plan: subscription.plan,
        currentUsage: effectiveCurrentUsage,
        usageLimit: orgUsageLimit,
        percentUsed,
        isWarning,
        isExceeded,
        daysRemaining,
        creditBalance: orgCreditBalance,
        billingInterval: orgBillingInterval,
        // Subscription details
        isPaid: planIsPaid,
        isPro: planIsPro,
        isTeam: planIsTeam,
        isEnterprise: planIsEnterprise,
        isOrgScoped: true,
        organizationId: organizationId,
        status: subscription.status || null,
        seats: subscription.seats || null,
        metadata: subscription.metadata || null,
        stripeSubscriptionId: subscription.stripeSubscriptionId || null,
        periodEnd: subscription.periodEnd || null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || undefined,
        // Usage details
        usage: {
          current: effectiveCurrentUsage,
          limit: orgUsageLimit,
          percentUsed,
          isWarning,
          isExceeded,
          billingPeriodStart: subscription.periodStart ?? null,
          billingPeriodEnd: subscription.periodEnd ?? null,
          lastPeriodCost: pooled.lastPeriodCost,
          lastPeriodCopilotCost: totalLastPeriodCopilotCost,
          daysRemaining,
          copilotCost: totalCopilotCost,
        },
      }
    }

    const ledgerUsage = await calculateCurrentLedgerUsageForUser(userId, subscription)
    const copilotCost =
      (ledgerUsage.sourceTotals.copilot ?? 0) + (ledgerUsage.sourceTotals.mcp_copilot ?? 0)

    let lastPeriodCopilotCost = 0
    if (usageData.billingPeriodStart && usageData.billingPeriodEnd) {
      const periodMs = usageData.billingPeriodEnd.getTime() - usageData.billingPeriodStart.getTime()
      if (periodMs > 0) {
        const lastPeriodUsage = await calculateCurrentLedgerUsageForUser(userId, subscription, db, {
          periodStart: new Date(usageData.billingPeriodStart.getTime() - periodMs),
          periodEnd: usageData.billingPeriodStart,
        })
        lastPeriodCopilotCost =
          (lastPeriodUsage.sourceTotals.copilot ?? 0) +
          (lastPeriodUsage.sourceTotals.mcp_copilot ?? 0)
      }
    }

    const currentUsage = usageData.currentUsage
    let totalCopilotCost = copilotCost
    let totalLastPeriodCopilotCost = lastPeriodCopilotCost
    if (orgScoped && subscription?.referenceId) {
      const pooled = await aggregateOrgMemberStats(subscription.referenceId, subscription)
      totalCopilotCost = pooled.currentPeriodCopilotCost
      totalLastPeriodCopilotCost = pooled.lastPeriodCopilotCost
    }

    const percentUsed = usageData.limit > 0 ? (currentUsage / usageData.limit) * 100 : 0

    const daysRemaining = usageData.billingPeriodEnd
      ? Math.max(
          0,
          Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0

    const userCredits = await getCreditBalance(userId)
    const individualBillingInterval = getBillingInterval(
      subscription?.metadata as SubscriptionMetadata
    )

    return {
      type: 'individual',
      plan,
      currentUsage,
      usageLimit: usageData.limit,
      percentUsed,
      isWarning: percentUsed >= 80 && percentUsed < 100,
      isExceeded: currentUsage >= usageData.limit,
      daysRemaining,
      creditBalance: userCredits.balance,
      billingInterval: individualBillingInterval,
      // Subscription details
      isPaid: planIsPaid,
      isPro: planIsPro,
      isTeam: planIsTeam,
      isEnterprise: planIsEnterprise,
      isOrgScoped: orgScoped,
      organizationId: subscriptionOrgId,
      status: subscription?.status || null,
      seats: subscription?.seats || null,
      metadata: subscription?.metadata || null,
      stripeSubscriptionId: subscription?.stripeSubscriptionId || null,
      periodEnd: subscription?.periodEnd || null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || undefined,
      // Usage details
      usage: {
        current: currentUsage,
        limit: usageData.limit,
        percentUsed,
        isWarning: percentUsed >= 80 && percentUsed < 100,
        isExceeded: currentUsage >= usageData.limit,
        billingPeriodStart: usageData.billingPeriodStart,
        billingPeriodEnd: usageData.billingPeriodEnd,
        lastPeriodCost: usageData.lastPeriodCost,
        lastPeriodCopilotCost: totalLastPeriodCopilotCost,
        daysRemaining,
        copilotCost: totalCopilotCost,
      },
    }
  } catch (error) {
    logger.error('Failed to get simplified billing summary', { userId, organizationId, error })
    return getDefaultBillingSummary(organizationId ? 'organization' : 'individual')
  }
}

/**
 * Get default billing summary for error cases
 */
function getDefaultBillingSummary(type: 'individual' | 'organization') {
  const freeTierLimit = getFreeTierLimit()
  return {
    type,
    plan: 'free',
    currentUsage: 0,
    usageLimit: freeTierLimit,
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    daysRemaining: 0,
    creditBalance: 0,
    billingInterval: 'month' as const,
    // Subscription details
    isPaid: false,
    isPro: false,
    isTeam: false,
    isEnterprise: false,
    isOrgScoped: false,
    organizationId: null,
    status: null,
    seats: null,
    metadata: null,
    stripeSubscriptionId: null,
    periodEnd: null,
    // Usage details
    usage: {
      current: 0,
      limit: freeTierLimit,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      lastPeriodCost: 0,
      lastPeriodCopilotCost: 0,
      daysRemaining: 0,
      copilotCost: 0,
    },
  }
}
