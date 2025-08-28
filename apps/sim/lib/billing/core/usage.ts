import { eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  canEditUsageLimit,
  getFreeTierLimit,
  getPerUserMinimumLimit,
} from '@/lib/billing/subscriptions/utils'
import type { BillingData, UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, organization, user, userStats } from '@/db/schema'

const logger = createLogger('UsageManagement')

/**
 * Handle new user setup when they join the platform
 * Creates userStats record with default free credits
 */
export async function handleNewUser(userId: string): Promise<void> {
  try {
    await db.insert(userStats).values({
      id: crypto.randomUUID(),
      userId: userId,
      currentUsageLimit: getFreeTierLimit().toString(),
      usageLimitUpdatedAt: new Date(),
    })

    logger.info('User stats record created for new user', { userId })
  } catch (error) {
    logger.error('Failed to create user stats record for new user', {
      userId,
      error,
    })
    throw error
  }
}

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(userId: string): Promise<UsageData> {
  try {
    const [userStatsData, subscription] = await Promise.all([
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
      getHighestPrioritySubscription(userId),
    ])

    if (userStatsData.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsData[0]
    const currentUsage = Number.parseFloat(
      stats.currentPeriodCost?.toString() ?? stats.totalCost.toString()
    )

    // Determine usage limit based on plan type
    let limit: number

    if (!subscription || subscription.plan === 'free' || subscription.plan === 'pro') {
      // Free/Pro: Use individual user limit from userStats
      limit = stats.currentUsageLimit
        ? Number.parseFloat(stats.currentUsageLimit)
        : getFreeTierLimit()
    } else {
      // Team/Enterprise: Use organization limit but never below minimum (seats × cost per seat)
      const orgData = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      const { getPlanPricing } = await import('@/lib/billing/core/billing')
      const { basePrice } = getPlanPricing(subscription.plan, subscription)
      const minimum = (subscription.seats || 1) * basePrice

      if (orgData.length > 0 && orgData[0].orgUsageLimit) {
        const configured = Number.parseFloat(orgData[0].orgUsageLimit)
        limit = Math.max(configured, minimum)
      } else {
        limit = minimum
      }
    }

    const percentUsed = limit > 0 ? Math.min(Math.floor((currentUsage / limit) * 100), 100) : 0
    const isWarning = percentUsed >= 80
    const isExceeded = currentUsage >= limit

    // Derive billing period dates from subscription (source of truth).
    // For free users or missing dates, expose nulls.
    const billingPeriodStart = subscription?.periodStart ?? null
    const billingPeriodEnd = subscription?.periodEnd ?? null

    return {
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
      billingPeriodStart,
      billingPeriodEnd,
      lastPeriodCost: Number.parseFloat(stats.lastPeriodCost?.toString() || '0'),
    }
  } catch (error) {
    logger.error('Failed to get user usage data', { userId, error })
    throw error
  }
}

/**
 * Get usage limit information for a user
 */
export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  try {
    const [subscription, userStatsRecord] = await Promise.all([
      getHighestPrioritySubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    if (userStatsRecord.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsRecord[0]

    // Determine limits based on plan type
    let currentLimit: number
    let minimumLimit: number
    let canEdit: boolean

    if (!subscription || subscription.plan === 'free' || subscription.plan === 'pro') {
      // Free/Pro: Use individual limits
      currentLimit = stats.currentUsageLimit
        ? Number.parseFloat(stats.currentUsageLimit)
        : getFreeTierLimit()
      minimumLimit = getPerUserMinimumLimit(subscription)
      canEdit = canEditUsageLimit(subscription)
    } else {
      // Team/Enterprise: Use organization limits (users cannot edit)
      const orgData = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      const { getPlanPricing } = await import('@/lib/billing/core/billing')
      const { basePrice } = getPlanPricing(subscription.plan, subscription)
      const minimum = (subscription.seats || 1) * basePrice

      if (orgData.length > 0 && orgData[0].orgUsageLimit) {
        const configured = Number.parseFloat(orgData[0].orgUsageLimit)
        currentLimit = Math.max(configured, minimum)
      } else {
        currentLimit = minimum
      }
      minimumLimit = minimum
      canEdit = false // Team/enterprise members cannot edit limits
    }

    return {
      currentLimit,
      canEdit,
      minimumLimit,
      plan: subscription?.plan || 'free',
      updatedAt: stats.usageLimitUpdatedAt,
    }
  } catch (error) {
    logger.error('Failed to get usage limit info', { userId, error })
    throw error
  }
}

/**
 * Initialize usage limits for a new user
 */
export async function initializeUserUsageLimit(userId: string): Promise<void> {
  // Check if user already has usage stats
  const existingStats = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (existingStats.length > 0) {
    return // User already has usage stats
  }

  // Check user's subscription to determine initial limit
  const subscription = await getHighestPrioritySubscription(userId)
  const isTeamOrEnterprise =
    subscription && (subscription.plan === 'team' || subscription.plan === 'enterprise')

  // Create initial usage stats
  await db.insert(userStats).values({
    id: crypto.randomUUID(),
    userId,
    // Team/enterprise: null (use org limit), Free/Pro: individual limit
    currentUsageLimit: isTeamOrEnterprise ? null : getFreeTierLimit().toString(),
    usageLimitUpdatedAt: new Date(),
  })

  logger.info('Initialized user stats', {
    userId,
    plan: subscription?.plan || 'free',
    hasIndividualLimit: !isTeamOrEnterprise,
  })
}

/**
 * Update a user's custom usage limit
 */
export async function updateUserUsageLimit(
  userId: string,
  newLimit: number,
  setBy?: string // For team admin tracking
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await getHighestPrioritySubscription(userId)

    // Team/enterprise users don't have individual limits
    if (subscription && (subscription.plan === 'team' || subscription.plan === 'enterprise')) {
      return {
        success: false,
        error: 'Team and enterprise members use organization limits',
      }
    }

    // Only pro users can edit limits (free users cannot)
    if (!subscription || subscription.plan === 'free') {
      return { success: false, error: 'Free plan users cannot edit usage limits' }
    }

    const minimumLimit = getPerUserMinimumLimit(subscription)

    logger.info('Applying plan-based validation', {
      userId,
      newLimit,
      minimumLimit,
      plan: subscription?.plan,
    })

    // Validate new limit is not below minimum
    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be below plan minimum of $${minimumLimit}`,
      }
    }

    // Get current usage to validate against
    const userStatsRecord = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (userStatsRecord.length > 0) {
      const currentUsage = Number.parseFloat(
        userStatsRecord[0].currentPeriodCost?.toString() || userStatsRecord[0].totalCost.toString()
      )

      // Validate new limit is not below current usage
      if (newLimit < currentUsage) {
        return {
          success: false,
          error: `Usage limit cannot be below current usage of $${currentUsage.toFixed(2)}`,
        }
      }
    }

    // Update the usage limit
    await db
      .update(userStats)
      .set({
        currentUsageLimit: newLimit.toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Updated user usage limit', {
      userId,
      newLimit,
      setBy: setBy || userId,
      planMinimum: minimumLimit,
      plan: subscription?.plan,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update usage limit', { userId, newLimit, error })
    return { success: false, error: 'Failed to update usage limit' }
  }
}

/**
 * Get usage limit for a user (used by checkUsageStatus for server-side checks)
 * Free/Pro: Individual user limit from userStats
 * Team/Enterprise: Organization limit
 */
export async function getUserUsageLimit(userId: string): Promise<number> {
  const subscription = await getHighestPrioritySubscription(userId)

  if (!subscription || subscription.plan === 'free' || subscription.plan === 'pro') {
    // Free/Pro: Use individual limit from userStats
    const userStatsQuery = await db
      .select({ currentUsageLimit: userStats.currentUsageLimit })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (userStatsQuery.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    // Individual limits should never be null for free/pro users
    if (!userStatsQuery[0].currentUsageLimit) {
      throw new Error(
        `Invalid null usage limit for ${subscription?.plan || 'free'} user: ${userId}`
      )
    }

    return Number.parseFloat(userStatsQuery[0].currentUsageLimit)
  }
  // Team/Enterprise: Use organization limit but never below minimum
  const orgData = await db
    .select({ orgUsageLimit: organization.orgUsageLimit })
    .from(organization)
    .where(eq(organization.id, subscription.referenceId))
    .limit(1)

  if (orgData.length === 0) {
    throw new Error(`Organization not found: ${subscription.referenceId}`)
  }

  if (orgData[0].orgUsageLimit) {
    const configured = Number.parseFloat(orgData[0].orgUsageLimit)
    const { getPlanPricing } = await import('@/lib/billing/core/billing')
    const { basePrice } = getPlanPricing(subscription.plan, subscription)
    const minimum = (subscription.seats || 1) * basePrice
    return Math.max(configured, minimum)
  }

  // If org hasn't set a custom limit, use minimum (seats × cost per seat)
  const { getPlanPricing } = await import('@/lib/billing/core/billing')
  const { basePrice } = getPlanPricing(subscription.plan, subscription)
  return (subscription.seats || 1) * basePrice
}

/**
 * Check usage status with warning thresholds
 */
export async function checkUsageStatus(userId: string): Promise<{
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}> {
  try {
    const usageData = await getUserUsageData(userId)

    let status: 'ok' | 'warning' | 'exceeded' = 'ok'
    if (usageData.isExceeded) {
      status = 'exceeded'
    } else if (usageData.isWarning) {
      status = 'warning'
    }

    return {
      status,
      usageData,
    }
  } catch (error) {
    logger.error('Failed to check usage status', { userId, error })
    throw error
  }
}

/**
 * Sync usage limits based on subscription changes
 */
export async function syncUsageLimitsFromSubscription(userId: string): Promise<void> {
  const [subscription, currentUserStats] = await Promise.all([
    getHighestPrioritySubscription(userId),
    db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
  ])

  if (currentUserStats.length === 0) {
    throw new Error(`User stats not found for userId: ${userId}`)
  }

  const currentStats = currentUserStats[0]

  // Team/enterprise: Should have null individual limits
  if (subscription && (subscription.plan === 'team' || subscription.plan === 'enterprise')) {
    if (currentStats.currentUsageLimit !== null) {
      await db
        .update(userStats)
        .set({
          currentUsageLimit: null,
          usageLimitUpdatedAt: new Date(),
        })
        .where(eq(userStats.userId, userId))

      logger.info('Cleared individual limit for team/enterprise member', {
        userId,
        plan: subscription.plan,
      })
    }
    return
  }

  // Free/Pro: Handle individual limits
  const defaultLimit = getPerUserMinimumLimit(subscription)
  const currentLimit = currentStats.currentUsageLimit
    ? Number.parseFloat(currentStats.currentUsageLimit)
    : 0

  if (!subscription || subscription.status !== 'active') {
    // Downgraded to free
    await db
      .update(userStats)
      .set({
        currentUsageLimit: getFreeTierLimit().toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Set limit to free tier', { userId })
  } else if (currentLimit < defaultLimit) {
    await db
      .update(userStats)
      .set({
        currentUsageLimit: defaultLimit.toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Raised limit to plan minimum', {
      userId,
      newLimit: defaultLimit,
    })
  }
  // Keep higher custom limits unchanged
}

/**
 * Get usage limit information for team members (for admin dashboard)
 */
export async function getTeamUsageLimits(organizationId: string): Promise<
  Array<{
    userId: string
    userName: string
    userEmail: string
    currentLimit: number
    currentUsage: number
    totalCost: number
    lastActive: Date | null
  }>
> {
  try {
    const teamMembers = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
        currentLimit: userStats.currentUsageLimit,
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
        lastActive: userStats.lastActive,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(eq(member.organizationId, organizationId))

    return teamMembers.map((memberData) => ({
      userId: memberData.userId,
      userName: memberData.userName,
      userEmail: memberData.userEmail,
      currentLimit: Number.parseFloat(memberData.currentLimit || getFreeTierLimit().toString()),
      currentUsage: Number.parseFloat(memberData.currentPeriodCost || '0'),
      totalCost: Number.parseFloat(memberData.totalCost || '0'),
      lastActive: memberData.lastActive,
    }))
  } catch (error) {
    logger.error('Failed to get team usage limits', { organizationId, error })
    return []
  }
}

/**
 * Calculate billing projection based on current usage
 */
export async function calculateBillingProjection(userId: string): Promise<BillingData> {
  try {
    const usageData = await getUserUsageData(userId)

    if (!usageData.billingPeriodStart || !usageData.billingPeriodEnd) {
      return {
        currentPeriodCost: usageData.currentUsage,
        projectedCost: usageData.currentUsage,
        limit: usageData.limit,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        daysRemaining: 0,
      }
    }

    const now = new Date()
    const periodStart = new Date(usageData.billingPeriodStart)
    const periodEnd = new Date(usageData.billingPeriodEnd)

    const totalDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    )
    const daysElapsed = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, totalDays - daysElapsed)

    // Project cost based on daily usage rate
    const dailyRate = daysElapsed > 0 ? usageData.currentUsage / daysElapsed : 0
    const projectedCost = dailyRate * totalDays

    return {
      currentPeriodCost: usageData.currentUsage,
      projectedCost: Math.min(projectedCost, usageData.limit), // Cap at limit
      limit: usageData.limit,
      billingPeriodStart: usageData.billingPeriodStart,
      billingPeriodEnd: usageData.billingPeriodEnd,
      daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to calculate billing projection', { userId, error })
    throw error
  }
}
