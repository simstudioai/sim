import { and, eq } from 'drizzle-orm'
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
