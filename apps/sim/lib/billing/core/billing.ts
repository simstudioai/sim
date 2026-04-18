import { db } from '@sim/db'
import { member, organization, subscription, userStats } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  getBillingInterval,
  getHighestPrioritySubscription,
  type SubscriptionMetadata,
} from '@/lib/billing/core/subscription'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getCreditBalance } from '@/lib/billing/credits/balance'
import { computeDailyRefreshConsumed } from '@/lib/billing/credits/daily-refresh'
import { getPlanTierDollars, isEnterprise, isPaid, isPro, isTeam } from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getFreeTierLimit,
  getPlanPricing,
  hasPaidSubscriptionStatus,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { Decimal, toDecimal, toNumber } from '@/lib/billing/utils/decimal'

export { getPlanPricing }

import { createLogger } from '@sim/logger'

const logger = createLogger('Billing')

/**
 * Get organization subscription directly by organization ID
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
 */
async function aggregateOrgMemberStats(organizationId: string): Promise<{
  memberIds: string[]
  currentPeriodCost: number
  currentPeriodCopilotCost: number
  lastPeriodCopilotCost: number
}> {
  const rows = await db
    .select({
      userId: member.userId,
      currentPeriodCost: userStats.currentPeriodCost,
      currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
      lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
    })
    .from(member)
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))

  let currentPeriodCost = new Decimal(0)
  let currentPeriodCopilotCost = new Decimal(0)
  let lastPeriodCopilotCost = new Decimal(0)
  const memberIds: string[] = []

  for (const row of rows) {
    memberIds.push(row.userId)
    currentPeriodCost = currentPeriodCost.plus(toDecimal(row.currentPeriodCost))
    currentPeriodCopilotCost = currentPeriodCopilotCost.plus(
      toDecimal(row.currentPeriodCopilotCost)
    )
    lastPeriodCopilotCost = lastPeriodCopilotCost.plus(toDecimal(row.lastPeriodCopilotCost))
  }

  return {
    memberIds,
    currentPeriodCost: toNumber(currentPeriodCost),
    currentPeriodCopilotCost: toNumber(currentPeriodCopilotCost),
    lastPeriodCopilotCost: toNumber(lastPeriodCopilotCost),
  }
}

/**
 * Calculate overage amount for a subscription
 * Shared logic between invoice.finalized and customer.subscription.deleted handlers
 */
export async function calculateSubscriptionOverage(sub: {
  id: string
  plan: string | null
  referenceId: string
  seats?: number | null
  periodStart?: Date | null
  periodEnd?: Date | null
}): Promise<number> {
  // Enterprise plans have no overages
  if (isEnterprise(sub.plan)) {
    logger.info('Enterprise plan has no overages', {
      subscriptionId: sub.id,
      plan: sub.plan,
    })
    return 0
  }

  let totalOverageDecimal = new Decimal(0)

  const isOrgScoped = await isSubscriptionOrgScoped(sub)

  if (isOrgScoped) {
    const pooled = await aggregateOrgMemberStats(sub.referenceId)
    const totalTeamUsageDecimal = toDecimal(pooled.currentPeriodCost)

    const orgData = await db
      .select({ departedMemberUsage: organization.departedMemberUsage })
      .from(organization)
      .where(eq(organization.id, sub.referenceId))
      .limit(1)

    const departedUsageDecimal =
      orgData.length > 0 ? toDecimal(orgData[0].departedMemberUsage) : new Decimal(0)

    const totalUsageWithDepartedDecimal = totalTeamUsageDecimal.plus(departedUsageDecimal)

    let dailyRefreshDeduction = 0
    const planDollars = getPlanTierDollars(sub.plan)
    if (planDollars > 0 && sub.periodStart) {
      dailyRefreshDeduction = await computeDailyRefreshConsumed({
        userIds: pooled.memberIds,
        periodStart: sub.periodStart,
        periodEnd: sub.periodEnd ?? null,
        planDollars,
        seats: sub.seats || 1,
      })
    }

    const effectiveUsageDecimal = Decimal.max(
      0,
      totalUsageWithDepartedDecimal.minus(toDecimal(dailyRefreshDeduction))
    )
    const { basePrice } = getPlanPricing(sub.plan ?? '')
    const baseSubscriptionAmount = (sub.seats || 1) * basePrice
    totalOverageDecimal = Decimal.max(0, effectiveUsageDecimal.minus(baseSubscriptionAmount))

    logger.info('Calculated org-scoped overage', {
      subscriptionId: sub.id,
      plan: sub.plan,
      currentMemberUsage: toNumber(totalTeamUsageDecimal),
      departedMemberUsage: toNumber(departedUsageDecimal),
      totalUsage: toNumber(totalUsageWithDepartedDecimal),
      baseSubscriptionAmount,
      totalOverage: toNumber(totalOverageDecimal),
    })
  } else if (isPro(sub.plan)) {
    // Read user_stats directly (not via `getUserUsageData`). Priority
    // lookup prefers org over personal within tier, so during a
    // cancel-at-period-end grace window it would return pooled org usage
    // instead of this user's personal period — overbilling the final
    // personal Pro invoice.
    const [statsRow] = await db
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
      })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)

    const personalCurrentUsage = statsRow ? toNumber(toDecimal(statsRow.currentPeriodCost)) : 0
    const snapshotUsage = statsRow ? toNumber(toDecimal(statsRow.proPeriodCostSnapshot)) : 0

    // If snapshot > 0 the user joined a paid org mid-cycle: pre-join
    // usage sits in `proPeriodCostSnapshot`, post-join is still
    // accumulating in `currentPeriodCost` and will be billed by the org.
    // Bill only the snapshot here to avoid double-charging.
    const joinedOrgMidCycle = snapshotUsage > 0
    const totalProUsageDecimal = joinedOrgMidCycle
      ? toDecimal(snapshotUsage)
      : toDecimal(personalCurrentUsage)

    if (joinedOrgMidCycle) {
      logger.info('Billing personal Pro only for pre-join usage (user joined org mid-cycle)', {
        userId: sub.referenceId,
        preJoinUsage: snapshotUsage,
        postJoinUsageOnMemberRow: personalCurrentUsage,
        subscriptionId: sub.id,
      })
    }

    let dailyRefreshDeduction = 0
    const planDollars = getPlanTierDollars(sub.plan)
    if (planDollars > 0 && sub.periodStart) {
      dailyRefreshDeduction = await computeDailyRefreshConsumed({
        userIds: [sub.referenceId],
        periodStart: sub.periodStart,
        periodEnd: sub.periodEnd ?? null,
        planDollars,
      })
    }

    const effectiveUsageDecimal = Decimal.max(
      0,
      totalProUsageDecimal.minus(toDecimal(dailyRefreshDeduction))
    )
    const { basePrice } = getPlanPricing(sub.plan ?? '')
    totalOverageDecimal = Decimal.max(0, effectiveUsageDecimal.minus(basePrice))

    logger.info('Calculated personal pro overage', {
      subscriptionId: sub.id,
      joinedOrgMidCycle,
      personalCurrentUsage,
      snapshot: snapshotUsage,
      billedUsage: toNumber(totalProUsageDecimal),
      dailyRefreshDeduction,
      basePrice,
      totalOverage: toNumber(totalOverageDecimal),
    })
  } else {
    // Free or unknown plan. Same direct-read rationale as the Pro branch.
    const [statsRow] = await db
      .select({ currentPeriodCost: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    const personalCurrentUsage = statsRow ? toNumber(toDecimal(statsRow.currentPeriodCost)) : 0
    const { basePrice } = getPlanPricing(sub.plan || 'free')
    totalOverageDecimal = Decimal.max(0, toDecimal(personalCurrentUsage).minus(basePrice))

    logger.info('Calculated overage for plan', {
      subscriptionId: sub.id,
      plan: sub.plan || 'free',
      usage: personalCurrentUsage,
      basePrice,
      totalOverage: toNumber(totalOverageDecimal),
    })
  }

  return toNumber(totalOverageDecimal)
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
      const pooled = await aggregateOrgMemberStats(organizationId)

      const totalCurrentUsage = pooled.currentPeriodCost
      const totalCopilotCost = pooled.currentPeriodCopilotCost
      const totalLastPeriodCopilotCost = pooled.lastPeriodCopilotCost

      const percentUsed =
        usageData.limit > 0 ? Math.round((usageData.currentUsage / usageData.limit) * 100) : 0

      // Calculate days remaining in billing period
      const daysRemaining = usageData.billingPeriodEnd
        ? Math.max(
            0,
            Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          )
        : 0

      const orgCredits = await getCreditBalance(userId)
      const orgBillingInterval = getBillingInterval(subscription.metadata as SubscriptionMetadata)

      return {
        type: 'organization',
        plan: subscription.plan,
        currentUsage: totalCurrentUsage,
        usageLimit: usageData.limit,
        percentUsed,
        isWarning: percentUsed >= 80 && percentUsed < 100,
        isExceeded: usageData.currentUsage >= usageData.limit,
        daysRemaining,
        creditBalance: orgCredits.balance,
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
          current: usageData.currentUsage,
          limit: usageData.limit,
          percentUsed,
          isWarning: percentUsed >= 80 && percentUsed < 100,
          isExceeded: usageData.currentUsage >= usageData.limit,
          billingPeriodStart: usageData.billingPeriodStart,
          billingPeriodEnd: usageData.billingPeriodEnd,
          lastPeriodCost: usageData.lastPeriodCost,
          lastPeriodCopilotCost: totalLastPeriodCopilotCost,
          daysRemaining,
          copilotCost: totalCopilotCost,
        },
      }
    }

    const userStatsRows = await db
      .select({
        currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
        lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const copilotCost =
      userStatsRows.length > 0 ? toNumber(toDecimal(userStatsRows[0].currentPeriodCopilotCost)) : 0

    const lastPeriodCopilotCost =
      userStatsRows.length > 0 ? toNumber(toDecimal(userStatsRows[0].lastPeriodCopilotCost)) : 0

    const currentUsage = usageData.currentUsage
    let totalCopilotCost = copilotCost
    let totalLastPeriodCopilotCost = lastPeriodCopilotCost
    if (orgScoped && subscription?.referenceId) {
      const pooled = await aggregateOrgMemberStats(subscription.referenceId)
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
