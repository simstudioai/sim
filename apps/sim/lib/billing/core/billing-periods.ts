import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { subscription, userStats } from '@/db/schema'

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
 */
export async function initializeBillingPeriod(userId: string): Promise<void> {
  try {
    // Get user's subscription to determine billing period
    const subscriptionData = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))
      .limit(1)

    const { start, end } = calculateBillingPeriod(subscriptionData[0]?.periodStart || undefined)

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
