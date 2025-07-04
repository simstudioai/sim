import { and, eq, gte, lt } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, subscription, userStats } from '@/db/schema'

const logger = createLogger('BillingPeriodManager')

/**
 * Calculate billing period dates based on subscription
 */
export function calculateBillingPeriod(subscriptionPeriodStart?: Date): {
  start: Date
  end: Date
} {
  const now = new Date()

  if (subscriptionPeriodStart) {
    // Use subscription start date to calculate billing period
    const start = new Date(subscriptionPeriodStart)
    const end = new Date(start)

    // Add one month to start date
    end.setMonth(end.getMonth() + 1)

    // If we're past the end date, calculate the next period
    while (end <= now) {
      start.setMonth(start.getMonth() + 1)
      end.setMonth(end.getMonth() + 1)
    }

    return { start, end }
  }

  // Default monthly billing period (1st to last day of month)
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  return { start, end }
}

/**
 * Initialize billing period for a user based on their subscription
 * Can optionally accept Stripe subscription dates to ensure proper alignment
 */
export async function initializeBillingPeriod(
  userId: string,
  stripeSubscriptionStart?: Date,
  stripeSubscriptionEnd?: Date
): Promise<void> {
  try {
    let start: Date
    let end: Date

    if (stripeSubscriptionStart && stripeSubscriptionEnd) {
      // Use Stripe subscription dates for perfect alignment
      start = stripeSubscriptionStart
      end = stripeSubscriptionEnd
      logger.info('Using Stripe subscription dates for billing period', {
        userId,
        stripeStart: stripeSubscriptionStart,
        stripeEnd: stripeSubscriptionEnd,
      })
    } else {
      // Fallback: Get user's subscription to determine billing period
      const subscriptionData = await db
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))
        .limit(1)

      const billingPeriod = calculateBillingPeriod(subscriptionData[0]?.periodStart || undefined)
      start = billingPeriod.start
      end = billingPeriod.end
    }

    // Update user stats with billing period info
    await db
      .update(userStats)
      .set({
        billingPeriodStart: start,
        billingPeriodEnd: end,
        currentPeriodCost: '0',
      })
      .where(eq(userStats.userId, userId))

    logger.info('Billing period initialized for user', {
      userId,
      billingPeriodStart: start,
      billingPeriodEnd: end,
    })
  } catch (error) {
    logger.error('Failed to initialize billing period', { userId, error })
    throw error
  }
}

/**
 * Get current billing period usage for a user
 */
export async function getCurrentPeriodUsage(userId: string): Promise<{
  currentPeriodCost: number
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  daysRemaining: number
}> {
  try {
    const userStatsData = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (userStatsData.length === 0) {
      return {
        currentPeriodCost: 0,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        daysRemaining: 0,
      }
    }

    const stats = userStatsData[0]
    const currentPeriodCost = Number.parseFloat(stats.currentPeriodCost || '0')
    const billingPeriodEnd = stats.billingPeriodEnd

    let daysRemaining = 0
    if (billingPeriodEnd) {
      const now = new Date()
      const diffTime = billingPeriodEnd.getTime() - now.getTime()
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
    }

    return {
      currentPeriodCost,
      billingPeriodStart: stats.billingPeriodStart,
      billingPeriodEnd: stats.billingPeriodEnd,
      daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to get current period usage', { userId, error })
    throw error
  }
}

/**
 * Reset billing period for a user (archive current usage and start new period)
 * This implements the Cursor model where usage resets monthly after billing
 */
export async function resetUserBillingPeriod(userId: string): Promise<void> {
  try {
    // Get current period data before reset
    const currentStats = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (currentStats.length === 0) {
      logger.warn('No user stats found for billing period reset', { userId })
      return
    }

    const stats = currentStats[0]
    const currentPeriodCost = stats.currentPeriodCost || '0'

    // Calculate next billing period
    const { start: newPeriodStart, end: newPeriodEnd } = calculateBillingPeriod()

    // Archive current period cost and reset for new period
    await db
      .update(userStats)
      .set({
        lastPeriodCost: currentPeriodCost, // Archive previous period
        currentPeriodCost: '0', // Reset to zero for new period
        billingPeriodStart: newPeriodStart,
        billingPeriodEnd: newPeriodEnd,
      })
      .where(eq(userStats.userId, userId))

    logger.info('Reset billing period for user', {
      userId,
      archivedAmount: currentPeriodCost,
      newPeriodStart,
      newPeriodEnd,
    })
  } catch (error) {
    logger.error('Failed to reset user billing period', { userId, error })
    throw error
  }
}

/**
 * Reset billing period for all members of an organization
 */
export async function resetOrganizationBillingPeriod(organizationId: string): Promise<void> {
  try {
    // Get all organization members
    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    if (members.length === 0) {
      logger.info('No members found for organization billing reset', { organizationId })
      return
    }

    // Reset billing period for each member
    const memberUserIds = members.map((m) => m.userId)

    for (const userId of memberUserIds) {
      await resetUserBillingPeriod(userId)
    }

    logger.info('Reset billing period for organization', {
      organizationId,
      memberCount: members.length,
    })
  } catch (error) {
    logger.error('Failed to reset organization billing period', { organizationId, error })
    throw error
  }
}

/**
 * Get all users who have billing periods ending today
 */
export async function getUsersWithEndedBillingPeriods(): Promise<string[]> {
  try {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

    const endedPeriods = await db
      .select({ userId: userStats.userId })
      .from(userStats)
      .where(
        and(
          gte(userStats.billingPeriodEnd, startOfToday),
          lt(userStats.billingPeriodEnd, startOfTomorrow)
        )
      )

    const userIds = endedPeriods.map((record) => record.userId)

    logger.info('Found users with billing periods ending today', {
      count: userIds.length,
      userIds,
      startOfToday,
      startOfTomorrow,
    })

    return userIds
  } catch (error) {
    logger.error('Failed to get users with ended billing periods', { error })
    return []
  }
}

/**
 * Check if a user's billing period has ended and needs reset
 */
export async function shouldResetBillingPeriod(userId: string): Promise<boolean> {
  try {
    const currentUsage = await getCurrentPeriodUsage(userId)

    if (!currentUsage.billingPeriodEnd) {
      return false // No billing period set
    }

    const now = new Date()
    return now >= currentUsage.billingPeriodEnd
  } catch (error) {
    logger.error('Failed to check if billing period should reset', { userId, error })
    return false
  }
}

/**
 * Get billing period summary for a user
 */
export async function getBillingPeriodSummary(userId: string): Promise<{
  currentPeriod: {
    start: Date | null
    end: Date | null
    cost: number
    daysRemaining: number
  }
  lastPeriod: {
    cost: number
  }
}> {
  try {
    const [currentUsage, userStatsData] = await Promise.all([
      getCurrentPeriodUsage(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    const lastPeriodCost =
      userStatsData.length > 0 ? Number.parseFloat(userStatsData[0].lastPeriodCost || '0') : 0

    return {
      currentPeriod: {
        start: currentUsage.billingPeriodStart,
        end: currentUsage.billingPeriodEnd,
        cost: currentUsage.currentPeriodCost,
        daysRemaining: currentUsage.daysRemaining,
      },
      lastPeriod: {
        cost: lastPeriodCost,
      },
    }
  } catch (error) {
    logger.error('Failed to get billing period summary', { userId, error })
    throw error
  }
}
