import { db } from '@sim/db'
import { member, organization, subscription, user, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { getCreditBalance } from '@/lib/billing/credits/balance'
import { getFreeTierLimit, getPlanPricing } from '@/lib/billing/subscriptions/utils'
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
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
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
 * Calculate overage billing for a user
 * Returns only the amount that exceeds their subscription base price
 */
export async function calculateUserOverage(userId: string): Promise<{
  basePrice: number
  actualUsage: number
  overageAmount: number
  plan: string
} | null> {
  try {
    // Get user's subscription and usage data
    const [subscription, usageData, userRecord] = await Promise.all([
      getHighestPrioritySubscription(userId),
      getUserUsageData(userId),
      db.select().from(user).where(eq(user.id, userId)).limit(1),
    ])

    if (userRecord.length === 0) {
      logger.warn('User not found for overage calculation', { userId })
      return null
    }

    const plan = subscription?.plan || 'free'
    const { basePrice } = getPlanPricing(plan)
    const actualUsage = usageData.currentUsage

    // Calculate overage: any usage beyond what they already paid for
    const overageAmount = Math.max(0, actualUsage - basePrice)

    return {
      basePrice,
      actualUsage,
      overageAmount,
      plan,
    }
  } catch (error) {
    logger.error('Failed to calculate user overage', { userId, error })
    return null
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
}): Promise<number> {
  // Enterprise plans have no overages
  if (sub.plan === 'enterprise') {
    logger.info('Enterprise plan has no overages', {
      subscriptionId: sub.id,
      plan: sub.plan,
    })
    return 0
  }

  let totalOverageDecimal = new Decimal(0)

  if (sub.plan === 'team') {
    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, sub.referenceId))

    let totalTeamUsageDecimal = new Decimal(0)
    for (const m of members) {
      const usage = await getUserUsageData(m.userId)
      totalTeamUsageDecimal = totalTeamUsageDecimal.plus(toDecimal(usage.currentUsage))
    }

    const orgData = await db
      .select({ departedMemberUsage: organization.departedMemberUsage })
      .from(organization)
      .where(eq(organization.id, sub.referenceId))
      .limit(1)

    const departedUsageDecimal =
      orgData.length > 0 ? toDecimal(orgData[0].departedMemberUsage) : new Decimal(0)

    const totalUsageWithDepartedDecimal = totalTeamUsageDecimal.plus(departedUsageDecimal)
    const { basePrice } = getPlanPricing(sub.plan)
    const baseSubscriptionAmount = (sub.seats ?? 0) * basePrice
    totalOverageDecimal = Decimal.max(
      0,
      totalUsageWithDepartedDecimal.minus(baseSubscriptionAmount)
    )

    logger.info('Calculated team overage', {
      subscriptionId: sub.id,
      currentMemberUsage: toNumber(totalTeamUsageDecimal),
      departedMemberUsage: toNumber(departedUsageDecimal),
      totalUsage: toNumber(totalUsageWithDepartedDecimal),
      baseSubscriptionAmount,
      totalOverage: toNumber(totalOverageDecimal),
    })
  } else if (sub.plan === 'pro') {
    // Pro plan: include snapshot if user joined a team
    const usage = await getUserUsageData(sub.referenceId)
    let totalProUsageDecimal = toDecimal(usage.currentUsage)

    // Add any snapshotted Pro usage (from when they joined a team)
    const userStatsRows = await db
      .select({ proPeriodCostSnapshot: userStats.proPeriodCostSnapshot })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)

    if (userStatsRows.length > 0 && userStatsRows[0].proPeriodCostSnapshot) {
      const snapshotUsageDecimal = toDecimal(userStatsRows[0].proPeriodCostSnapshot)
      totalProUsageDecimal = totalProUsageDecimal.plus(snapshotUsageDecimal)
      logger.info('Including snapshotted Pro usage in overage calculation', {
        userId: sub.referenceId,
        currentUsage: usage.currentUsage,
        snapshotUsage: toNumber(snapshotUsageDecimal),
        totalProUsage: toNumber(totalProUsageDecimal),
      })
    }

    const { basePrice } = getPlanPricing(sub.plan)
    totalOverageDecimal = Decimal.max(0, totalProUsageDecimal.minus(basePrice))

    logger.info('Calculated pro overage', {
      subscriptionId: sub.id,
      totalProUsage: toNumber(totalProUsageDecimal),
      basePrice,
      totalOverage: toNumber(totalOverageDecimal),
    })
  } else {
    // Free plan or unknown plan type
    const usage = await getUserUsageData(sub.referenceId)
    const { basePrice } = getPlanPricing(sub.plan || 'free')
    totalOverageDecimal = Decimal.max(0, toDecimal(usage.currentUsage).minus(basePrice))

    logger.info('Calculated overage for plan', {
      subscriptionId: sub.id,
      plan: sub.plan || 'free',
      usage: usage.currentUsage,
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
  basePrice: number
  currentUsage: number
  overageAmount: number
  totalProjected: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  creditBalance: number
  // Subscription details
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
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
  organizationData?: {
    seatCount: number
    memberCount: number
    totalBasePrice: number
    totalCurrentUsage: number
    totalOverage: number
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

    // Determine subscription type flags
    const plan = subscription?.plan || 'free'
    const isPaid = plan !== 'free'
    const isPro = plan === 'pro'
    const isTeam = plan === 'team'
    const isEnterprise = plan === 'enterprise'

    if (organizationId) {
      // Organization billing summary
      if (!subscription) {
        return getDefaultBillingSummary('organization')
      }

      // Get all organization members
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      const { basePrice: basePricePerSeat } = getPlanPricing(subscription.plan)
      // Use licensed seats from Stripe as source of truth
      const licensedSeats = subscription.seats ?? 0
      const totalBasePrice = basePricePerSeat * licensedSeats // Based on Stripe subscription

      let totalCurrentUsageDecimal = new Decimal(0)
      let totalCopilotCostDecimal = new Decimal(0)
      let totalLastPeriodCopilotCostDecimal = new Decimal(0)

      // Calculate total team usage across all members
      for (const memberInfo of members) {
        const memberUsageData = await getUserUsageData(memberInfo.userId)
        totalCurrentUsageDecimal = totalCurrentUsageDecimal.plus(
          toDecimal(memberUsageData.currentUsage)
        )

        // Fetch copilot cost for this member
        const memberStats = await db
          .select({
            currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
            lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
          })
          .from(userStats)
          .where(eq(userStats.userId, memberInfo.userId))
          .limit(1)

        if (memberStats.length > 0) {
          totalCopilotCostDecimal = totalCopilotCostDecimal.plus(
            toDecimal(memberStats[0].currentPeriodCopilotCost)
          )
          totalLastPeriodCopilotCostDecimal = totalLastPeriodCopilotCostDecimal.plus(
            toDecimal(memberStats[0].lastPeriodCopilotCost)
          )
        }
      }

      const totalCurrentUsage = toNumber(totalCurrentUsageDecimal)
      const totalCopilotCost = toNumber(totalCopilotCostDecimal)
      const totalLastPeriodCopilotCost = toNumber(totalLastPeriodCopilotCostDecimal)

      // Calculate team-level overage: total usage beyond what was already paid to Stripe
      const totalOverage = toNumber(Decimal.max(0, totalCurrentUsageDecimal.minus(totalBasePrice)))

      // Get user's personal limits for warnings
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

      return {
        type: 'organization',
        plan: subscription.plan,
        basePrice: totalBasePrice,
        currentUsage: totalCurrentUsage,
        overageAmount: totalOverage,
        totalProjected: totalBasePrice + totalOverage,
        usageLimit: usageData.limit,
        percentUsed,
        isWarning: percentUsed >= 80 && percentUsed < 100,
        isExceeded: usageData.currentUsage >= usageData.limit,
        daysRemaining,
        creditBalance: orgCredits.balance,
        // Subscription details
        isPaid,
        isPro,
        isTeam,
        isEnterprise,
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
        organizationData: {
          seatCount: licensedSeats,
          memberCount: members.length,
          totalBasePrice,
          totalCurrentUsage,
          totalOverage,
        },
      }
    }

    // Individual billing summary
    const { basePrice } = getPlanPricing(plan)

    // Fetch user stats for copilot cost breakdown
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

    // For team and enterprise plans, calculate total team usage instead of individual usage
    let currentUsage = usageData.currentUsage
    let totalCopilotCost = copilotCost
    let totalLastPeriodCopilotCost = lastPeriodCopilotCost
    if ((isTeam || isEnterprise) && subscription?.referenceId) {
      // Get all team members and sum their usage
      const teamMembers = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, subscription.referenceId))

      let totalTeamUsageDecimal = new Decimal(0)
      let totalTeamCopilotCostDecimal = new Decimal(0)
      let totalTeamLastPeriodCopilotCostDecimal = new Decimal(0)
      for (const teamMember of teamMembers) {
        const memberUsageData = await getUserUsageData(teamMember.userId)
        totalTeamUsageDecimal = totalTeamUsageDecimal.plus(toDecimal(memberUsageData.currentUsage))

        // Fetch copilot cost for this team member
        const memberStats = await db
          .select({
            currentPeriodCopilotCost: userStats.currentPeriodCopilotCost,
            lastPeriodCopilotCost: userStats.lastPeriodCopilotCost,
          })
          .from(userStats)
          .where(eq(userStats.userId, teamMember.userId))
          .limit(1)

        if (memberStats.length > 0) {
          totalTeamCopilotCostDecimal = totalTeamCopilotCostDecimal.plus(
            toDecimal(memberStats[0].currentPeriodCopilotCost)
          )
          totalTeamLastPeriodCopilotCostDecimal = totalTeamLastPeriodCopilotCostDecimal.plus(
            toDecimal(memberStats[0].lastPeriodCopilotCost)
          )
        }
      }
      currentUsage = toNumber(totalTeamUsageDecimal)
      totalCopilotCost = toNumber(totalTeamCopilotCostDecimal)
      totalLastPeriodCopilotCost = toNumber(totalTeamLastPeriodCopilotCostDecimal)
    }

    const overageAmount = toNumber(Decimal.max(0, toDecimal(currentUsage).minus(basePrice)))
    const percentUsed = usageData.limit > 0 ? (currentUsage / usageData.limit) * 100 : 0

    // Calculate days remaining in billing period
    const daysRemaining = usageData.billingPeriodEnd
      ? Math.max(
          0,
          Math.ceil((usageData.billingPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        )
      : 0

    const userCredits = await getCreditBalance(userId)

    return {
      type: 'individual',
      plan,
      basePrice,
      currentUsage: currentUsage,
      overageAmount,
      totalProjected: basePrice + overageAmount,
      usageLimit: usageData.limit,
      percentUsed,
      isWarning: percentUsed >= 80 && percentUsed < 100,
      isExceeded: currentUsage >= usageData.limit,
      daysRemaining,
      creditBalance: userCredits.balance,
      // Subscription details
      isPaid,
      isPro,
      isTeam,
      isEnterprise,
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
  return {
    type,
    plan: 'free',
    basePrice: 0,
    currentUsage: 0,
    overageAmount: 0,
    totalProjected: 0,
    usageLimit: getFreeTierLimit(),
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    daysRemaining: 0,
    creditBalance: 0,
    // Subscription details
    isPaid: false,
    isPro: false,
    isTeam: false,
    isEnterprise: false,
    status: null,
    seats: null,
    metadata: null,
    stripeSubscriptionId: null,
    periodEnd: null,
    // Usage details
    usage: {
      current: 0,
      limit: getFreeTierLimit(),
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
    ...(type === 'organization' && {
      organizationData: {
        seatCount: 0,
        memberCount: 0,
        totalBasePrice: 0,
        totalCurrentUsage: 0,
        totalOverage: 0,
      },
    }),
  }
}
