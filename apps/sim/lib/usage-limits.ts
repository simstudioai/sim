import { eq } from 'drizzle-orm'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { createLogger } from './logs/console-logger'
import { getHighestPrioritySubscription } from './subscription/subscription'
import { calculateDefaultUsageLimit, canEditUsageLimit } from './subscription/utils'

const logger = createLogger('UsageLimits')

/**
 * Initialize usage limits for a new user
 * Sets default $5 limit for free plan users
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
    })

    logger.info('Initialized usage limit for new user', { userId, limit: 5 })
  } catch (error) {
    logger.error('Failed to initialize usage limit', { userId, error })
    throw error
  }
}

/**
 * Sync usage limits based on subscription changes
 * Called when subscriptions are created, updated, or cancelled
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
 * Update a user's custom usage limit
 * Only allowed for paid plan users
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
 * Get usage limit for a user from user_stats
 * This is the new primary method for getting usage limits
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
 * Get usage limit information for team members (for admin dashboard)
 */
export async function getTeamUsageLimits(organizationId: string): Promise<
  Array<{
    userId: string
    userName: string
    userEmail: string
    currentLimit: number
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
