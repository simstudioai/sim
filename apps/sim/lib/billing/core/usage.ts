import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { calculateDefaultUsageLimit, canEditUsageLimit } from '../subscriptions/utils'
import type { BillingData, UsageData, UsageLimitInfo } from '../types'
import { getHighestPrioritySubscription } from './subscription'

const logger = createLogger('UsageManagement')

/**
 * Consolidated usage management module
 * Handles user usage tracking, limits, and monitoring
 */

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(userId: string): Promise<UsageData> {
  try {
    const userStats = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1)

    if (userStats.length === 0) {
      // Initialize user stats if they don't exist
      await initializeUserUsageLimit(userId)
      return {
        currentUsage: 0,
        limit: 5,
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        lastPeriodCost: 0,
      }
    }

    const stats = userStats[0]
    const currentUsage = Number.parseFloat(
      stats.currentPeriodCost?.toString() || stats.totalCost.toString()
    )
    const limit = Number.parseFloat(stats.currentUsageLimit)
    const percentUsed = limit > 0 ? Math.round((currentUsage / limit) * 100) : 0
    const isWarning = percentUsed >= 80
    const isExceeded = currentUsage >= limit

    return {
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
      billingPeriodStart: stats.billingPeriodStart,
      billingPeriodEnd: stats.billingPeriodEnd,
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
    const subscription = await getHighestPrioritySubscription(userId)
    const canEdit = canEditUsageLimit(subscription)
    const minimumLimit = calculateDefaultUsageLimit(subscription)

    const userStats = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1)

    if (userStats.length === 0) {
      await initializeUserUsageLimit(userId)
      return {
        currentLimit: 5,
        canEdit: false,
        minimumLimit: 5,
        plan: 'free',
        setBy: null,
        updatedAt: null,
      }
    }

    const stats = userStats[0]
    return {
      currentLimit: Number.parseFloat(stats.currentUsageLimit),
      canEdit,
      minimumLimit,
      plan: subscription?.plan || 'free',
      setBy: stats.usageLimitSetBy,
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
  try {
    // Check if user already has usage stats
    const existingStats = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1)

    if (existingStats.length > 0) {
      return // User already has usage stats, don't override
    }

    // Create initial usage stats with default $5 limit
    await db.insert(schema.userStats).values({
      id: crypto.randomUUID(),
      userId,
      currentUsageLimit: '5', // Default $5 for new users
      usageLimitUpdatedAt: new Date(),
      billingPeriodStart: new Date(), // Start billing period immediately
    })

    logger.info('Initialized usage limit for new user', { userId, limit: 5 })
  } catch (error) {
    logger.error('Failed to initialize usage limit', { userId, error })
    throw error
  }
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

    // Check if user can edit limits
    if (!canEditUsageLimit(subscription)) {
      return { success: false, error: 'Free plan users cannot edit usage limits' }
    }

    const minimumLimit = calculateDefaultUsageLimit(subscription)

    // Validate new limit is not below minimum
    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be below plan minimum of $${minimumLimit}`,
      }
    }

    // Update the usage limit
    await db
      .update(schema.userStats)
      .set({
        currentUsageLimit: newLimit.toString(),
        usageLimitSetBy: setBy || userId,
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(schema.userStats.userId, userId))

    logger.info('Updated user usage limit', {
      userId,
      newLimit,
      setBy: setBy || userId,
      planMinimum: minimumLimit,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update usage limit', { userId, newLimit, error })
    return { success: false, error: 'Failed to update usage limit' }
  }
}

/**
 * Get usage limit for a user (simple version)
 */
export async function getUserUsageLimit(userId: string): Promise<number> {
  try {
    const userStats = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1)

    if (userStats.length === 0) {
      // User doesn't have stats yet, initialize and return default
      await initializeUserUsageLimit(userId)
      return 5 // Default free plan limit
    }

    return Number.parseFloat(userStats[0].currentUsageLimit)
  } catch (error) {
    logger.error('Failed to get user usage limit', { userId, error })
    return 5 // Fallback to safe default
  }
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
  try {
    const subscription = await getHighestPrioritySubscription(userId)
    const defaultLimit = calculateDefaultUsageLimit(subscription)

    // Get current user stats
    const userStats = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1)

    if (userStats.length === 0) {
      // Create new user stats with default limit
      await db.insert(schema.userStats).values({
        id: crypto.randomUUID(),
        userId,
        currentUsageLimit: defaultLimit.toString(),
        usageLimitUpdatedAt: new Date(),
      })
      logger.info('Created usage stats with synced limit', { userId, limit: defaultLimit })
      return
    }

    const currentStats = userStats[0]
    const currentLimit = Number.parseFloat(currentStats.currentUsageLimit)

    // Only update if subscription is free plan or if current limit is below new minimum
    if (!subscription || subscription.status !== 'active') {
      // User downgraded to free plan - cap at $5
      await db
        .update(schema.userStats)
        .set({
          currentUsageLimit: '5',
          usageLimitUpdatedAt: new Date(),
        })
        .where(eq(schema.userStats.userId, userId))

      logger.info('Synced usage limit to free plan', { userId, limit: 5 })
    } else if (currentLimit < defaultLimit) {
      // User upgraded and current limit is below new minimum - raise to minimum
      await db
        .update(schema.userStats)
        .set({
          currentUsageLimit: defaultLimit.toString(),
          usageLimitUpdatedAt: new Date(),
        })
        .where(eq(schema.userStats.userId, userId))

      logger.info('Synced usage limit to new minimum', {
        userId,
        oldLimit: currentLimit,
        newLimit: defaultLimit,
      })
    }
    // If user has higher custom limit, keep it unchanged
  } catch (error) {
    logger.error('Failed to sync usage limits', { userId, error })
    throw error
  }
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
    limitSetBy: string | null
    limitUpdatedAt: Date | null
  }>
> {
  try {
    const teamMembers = await db
      .select({
        userId: schema.member.userId,
        userName: schema.user.name,
        userEmail: schema.user.email,
        currentLimit: schema.userStats.currentUsageLimit,
        currentPeriodCost: schema.userStats.currentPeriodCost,
        totalCost: schema.userStats.totalCost,
        lastActive: schema.userStats.lastActive,
        limitSetBy: schema.userStats.usageLimitSetBy,
        limitUpdatedAt: schema.userStats.usageLimitUpdatedAt,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .leftJoin(schema.userStats, eq(schema.member.userId, schema.userStats.userId))
      .where(eq(schema.member.organizationId, organizationId))

    return teamMembers.map((member) => ({
      userId: member.userId,
      userName: member.userName,
      userEmail: member.userEmail,
      currentLimit: Number.parseFloat(member.currentLimit || '5'),
      currentUsage: Number.parseFloat(member.currentPeriodCost || '0'),
      totalCost: Number.parseFloat(member.totalCost || '0'),
      lastActive: member.lastActive,
      limitSetBy: member.limitSetBy,
      limitUpdatedAt: member.limitUpdatedAt,
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
