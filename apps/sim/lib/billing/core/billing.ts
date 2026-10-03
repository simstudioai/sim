import { db } from '@sim/db'
import { organization, subscription, userStats } from '@sim/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getHighestPriorityPersonalSubscription,
  resolveBillingInterval,
} from '@/lib/billing/core/subscription'
import { ensureUserStatsExists } from '@/lib/billing/core/usage'
import {
  COPILOT_USAGE_SOURCES,
  getBillingPeriodUsageCost,
  getBillingPeriodUsageCostWithSourceSubset,
} from '@/lib/billing/core/usage-log'
import { computeWeeklyRefreshConsumed } from '@/lib/billing/credits/weekly-refresh'
import {
  getPlanWeeklyRefreshDollars,
  isEnterprise,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getFreeTierLimit,
  getPlanPricing,
  hasPaidSubscriptionStatus,
} from '@/lib/billing/subscriptions/utils'
import { Decimal, toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import type { DbClient, DbOrTx } from '@/lib/db/types'

export { getPlanPricing }

import { createLogger } from '@sim/logger'

const logger = createLogger('Billing')

interface GetOrganizationSubscriptionOptions {
  onError?: 'return-null' | 'throw'
  /** Primary/replica client or a caller-owned enforcement transaction. */
  executor?: DbClient | DbOrTx
  /** Row-lock the selected entitlement inside a caller-owned transaction. */
  forUpdate?: boolean
}

/**
 * Get the organization's subscription row when its status is one of
 * `ENTITLED_SUBSCRIPTION_STATUSES` (includes `past_due`). Use this
 * when making billing-side decisions (overage math, limit reads,
 * webhooks) where `past_due` still counts as an active paid tenant.
 * For product-access gating use `getOrganizationSubscriptionUsable`
 * (from `core/subscription.ts`), which excludes `past_due`.
 * Returns `null` when there is no entitled sub.
 *
 * Enforcement and webhook callers must read the primary. They may pass a
 * caller-owned primary transaction when the subscription must be revalidated
 * and row-locked with another mutation.
 */
export async function getOrganizationSubscription(
  organizationId: string,
  options: GetOrganizationSubscriptionOptions = {}
) {
  const { onError = 'return-null', executor = db, forUpdate = false } = options
  try {
    const query = executor
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
    const orgSubs = forUpdate ? await query.for('update') : await query

    return orgSubs.length > 0 ? orgSubs[0] : null
  } catch (error) {
    logger.error('Error getting organization subscription', { error, organizationId })
    if (onError === 'throw') {
      throw error
    }
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
 * answer — the plan name alone is unreliable because a team plan can be
 * transiently user-referenced between checkout and webhook re-homing.
 * (The converse cannot happen: org-referenced subscriptions only ever
 * hold Team or Enterprise plans, enforced at checkout authorization and
 * in the Stripe plan sync.)
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
 * Compute an org's overage amount from an already-fetched pooled ledger sum.
 * Internally performs one weekly-refresh DB read to subtract refresh credits;
 * callers pass the org-attributed ledger usage for the period (threshold
 * billing passes the current period; cycle close passes the closed period).
 * All callers route through this to keep the overage math in one place.
 */
export async function computeOrgOverageAmount(params: {
  plan: string | null
  seats: number | null
  periodStart: Date | null
  periodEnd: Date | null
  organizationId: string
  pooledLedgerUsage: number
}): Promise<{
  effectiveUsage: number
  baseSubscriptionAmount: number
  weeklyRefreshDeduction: number
  totalOverage: number
}> {
  const totalUsage = params.pooledLedgerUsage

  let weeklyRefreshDeduction = 0
  const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(params.plan)
  if (weeklyRefreshDollars > 0 && params.periodStart) {
    weeklyRefreshDeduction = await computeWeeklyRefreshConsumed({
      billingEntity: { type: 'organization', id: params.organizationId },
      periodStart: params.periodStart,
      periodEnd: params.periodEnd ?? null,
      weeklyRefreshDollars,
      seats: params.seats || 1,
    })
  }

  const effectiveUsage = Math.max(0, totalUsage - weeklyRefreshDeduction)
  const { basePrice } = getPlanPricing(params.plan ?? '')
  const baseSubscriptionAmount = (params.seats || 1) * basePrice
  const totalOverage = Math.max(0, effectiveUsage - baseSubscriptionAmount)

  return { effectiveUsage, baseSubscriptionAmount, weeklyRefreshDeduction, totalOverage }
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
    const ledgerUsage =
      sub.periodStart && sub.periodEnd
        ? await getBillingPeriodUsageCost(
            { type: 'organization', id: sub.referenceId },
            { start: sub.periodStart, end: sub.periodEnd }
          )
        : 0

    const { totalOverage, effectiveUsage, baseSubscriptionAmount } = await computeOrgOverageAmount({
      plan: sub.plan,
      seats: sub.seats ?? null,
      periodStart: sub.periodStart ?? null,
      periodEnd: sub.periodEnd ?? null,
      organizationId: sub.referenceId,
      pooledLedgerUsage: ledgerUsage,
    })

    totalOverageDecimal = toDecimal(totalOverage)

    logger.info('Calculated org-scoped overage', {
      subscriptionId: sub.id,
      plan: sub.plan,
      ledgerUsage,
      effectiveUsage,
      baseSubscriptionAmount,
      totalOverage,
    })
  } else {
    // Ledger sums are read for the exact reference user (not via
    // `getUserUsageData`). Priority lookup prefers org over personal within
    // tier, so during a cancel-at-period-end grace window it would return
    // pooled org usage instead of this user's personal period — overbilling
    // the final personal invoice. Ledger entity stamps already attribute
    // post-org-join usage to the org, so the personal sum excludes it.
    const ledgerUsage =
      sub.periodStart && sub.periodEnd
        ? await getBillingPeriodUsageCost(
            { type: 'user', id: sub.referenceId },
            { start: sub.periodStart, end: sub.periodEnd }
          )
        : 0

    let weeklyRefreshDeduction = 0
    if (isPro(sub.plan)) {
      const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(sub.plan)
      if (weeklyRefreshDollars > 0 && sub.periodStart) {
        weeklyRefreshDeduction = await computeWeeklyRefreshConsumed({
          billingEntity: { type: 'user', id: sub.referenceId },
          periodStart: sub.periodStart,
          periodEnd: sub.periodEnd ?? null,
          weeklyRefreshDollars,
        })
      }
    }

    const { basePrice } = getPlanPricing(sub.plan || 'free')
    totalOverageDecimal = Decimal.max(
      0,
      toDecimal(ledgerUsage).minus(toDecimal(weeklyRefreshDeduction)).minus(basePrice)
    )

    logger.info('Calculated personal overage', {
      subscriptionId: sub.id,
      plan: sub.plan || 'free',
      ledgerUsage,
      weeklyRefreshDeduction,
      basePrice,
      totalOverage: toNumber(totalOverageDecimal),
    })
  }

  return toNumber(totalOverageDecimal)
}

/**
 * Returns billing data for the exact personal payer only. Organization
 * memberships never participate in subscription, usage, credit, or blocked
 * status resolution.
 */
export async function getPersonalBillingSummary(userId: string, executor: DbClient = db) {
  try {
    await ensureUserStatsExists(userId)

    const [personalSubscription, statsRows] = await Promise.all([
      getHighestPriorityPersonalSubscription(userId, { executor }),
      db
        .select({
          currentUsageLimit: userStats.currentUsageLimit,
          lastPeriodCost: userStats.lastPeriodCost,
          lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
          creditBalance: userStats.creditBalance,
          billingBlocked: userStats.billingBlocked,
          billingBlockedReason: userStats.billingBlockedReason,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),
    ])

    const stats = statsRows[0]
    if (!stats) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const plan = personalSubscription?.plan ?? 'free'
    const billingPeriod =
      personalSubscription?.periodStart && personalSubscription.periodEnd
        ? { start: personalSubscription.periodStart, end: personalSubscription.periodEnd }
        : defaultBillingPeriod()
    const { total: ledgerUsage, subset: copilotLedgerUsage } =
      await getBillingPeriodUsageCostWithSourceSubset(
        { type: 'user', id: userId },
        billingPeriod,
        COPILOT_USAGE_SOURCES,
        executor
      )

    const currentUsage = toDecimal(ledgerUsage)

    let refreshDeduction = 0
    if (
      personalSubscription &&
      isPaid(plan) &&
      hasPaidSubscriptionStatus(personalSubscription.status) &&
      personalSubscription.periodStart
    ) {
      const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(plan)
      if (weeklyRefreshDollars > 0) {
        refreshDeduction = await computeWeeklyRefreshConsumed(
          {
            billingEntity: { type: 'user', id: userId },
            periodStart: personalSubscription.periodStart,
            periodEnd: personalSubscription.periodEnd ?? null,
            weeklyRefreshDollars,
          },
          executor
        )
      }
    }

    const effectiveCurrentUsage = Math.max(0, toNumber(currentUsage) - refreshDeduction)
    const usageLimit = stats.currentUsageLimit
      ? toNumber(toDecimal(stats.currentUsageLimit))
      : getFreeTierLimit()
    const percentUsed = usageLimit > 0 ? (effectiveCurrentUsage / usageLimit) * 100 : 0
    const isExceeded = effectiveCurrentUsage >= usageLimit
    const isWarning = !isExceeded && percentUsed >= 80
    const daysRemaining = personalSubscription?.periodEnd
      ? Math.max(
          0,
          Math.ceil((personalSubscription.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0
    const hasPaidEntitlement = hasPaidSubscriptionStatus(personalSubscription?.status)
    const billingBlocked = Boolean(stats.billingBlocked)

    return {
      type: 'individual' as const,
      plan,
      currentUsage: effectiveCurrentUsage,
      usageLimit,
      percentUsed,
      isWarning,
      isExceeded,
      daysRemaining,
      creditBalance: toNumber(toDecimal(stats.creditBalance)),
      billingInterval: resolveBillingInterval(personalSubscription),
      isPaid: hasPaidEntitlement && isPaid(plan),
      isPro: hasPaidEntitlement && isPro(plan),
      isTeam: hasPaidEntitlement && isTeam(plan),
      isEnterprise: hasPaidEntitlement && isEnterprise(plan),
      isOrgScoped: false,
      organizationId: null,
      status: personalSubscription?.status ?? null,
      seats: personalSubscription?.seats ?? null,
      metadata: personalSubscription?.metadata ?? null,
      stripeSubscriptionId: personalSubscription?.stripeSubscriptionId ?? null,
      periodEnd: personalSubscription?.periodEnd ?? null,
      cancelAtPeriodEnd: personalSubscription?.cancelAtPeriodEnd ?? false,
      billingBlocked,
      billingBlockedReason: billingBlocked ? (stats.billingBlockedReason ?? null) : null,
      blockedByOrgOwner: false,
      usage: {
        current: effectiveCurrentUsage,
        limit: usageLimit,
        percentUsed,
        isWarning,
        isExceeded,
        billingPeriodStart: personalSubscription?.periodStart ?? null,
        billingPeriodEnd: personalSubscription?.periodEnd ?? null,
        lastPeriodCost: toNumber(toDecimal(stats.lastPeriodCost)),
        lastPeriodCopilotCost: toNumber(toDecimal(stats.lastPeriodCopilotCost)),
        daysRemaining,
        copilotCost: copilotLedgerUsage,
      },
    }
  } catch (error) {
    logger.error('Failed to get personal billing summary', { userId, error })
    return {
      ...getDefaultBillingSummary('individual'),
      cancelAtPeriodEnd: false,
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    }
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
