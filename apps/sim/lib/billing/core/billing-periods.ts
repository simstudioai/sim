import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, subscription, userStats } from '@/db/schema'

const logger = createLogger('BillingPeriodManager')

/**
 * Calculate billing period dates based on subscription for proper Stripe alignment
 * Supports both subscription start date and full period alignment
 */
export function calculateBillingPeriod(
  subscriptionPeriodStart?: Date,
  subscriptionPeriodEnd?: Date
): {
  start: Date
  end: Date
} {
  const now = new Date()

  // If we have both subscription dates, use them for perfect alignment
  if (subscriptionPeriodStart && subscriptionPeriodEnd) {
    const start = new Date(subscriptionPeriodStart)
    const end = new Date(subscriptionPeriodEnd)

    // If we're past the current period, calculate the next period using calendar months
    if (now >= end) {
      const newStart = new Date(end)
      const newEnd = new Date(end)

      // Use UTC methods to avoid timezone issues
      newEnd.setUTCMonth(newEnd.getUTCMonth() + 1)

      logger.info('Calculated next billing period from subscription dates', {
        originalStart: subscriptionPeriodStart,
        originalEnd: subscriptionPeriodEnd,
        newStart,
        newEnd,
      })

      return { start: newStart, end: newEnd }
    }

    logger.info('Using current subscription billing period', {
      start,
      end,
    })

    return { start, end }
  }

  // If we only have subscription start date, calculate monthly periods from that date
  if (subscriptionPeriodStart) {
    const start = new Date(subscriptionPeriodStart)
    const end = new Date(start)

    // Add one month to start date using UTC to avoid timezone issues
    end.setUTCMonth(end.getUTCMonth() + 1)

    // If we're past the end date, calculate the current period
    while (end <= now) {
      start.setUTCMonth(start.getUTCMonth() + 1)
      end.setUTCMonth(end.getUTCMonth() + 1)
    }

    logger.info('Calculated billing period from subscription start date', {
      subscriptionStart: subscriptionPeriodStart,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    })

    return { start, end }
  }

  // Fallback: Default monthly billing period (1st to last day of month)
  // This should only be used for users without proper subscription data
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))

  logger.warn('Using fallback calendar month billing period', {
    start,
    end,
  })

  return { start, end }
}

/**
 * Calculate the next billing period starting from a given period end date
 */
export function calculateNextBillingPeriod(periodEnd: Date): {
  start: Date
  end: Date
} {
  const start = new Date(periodEnd)
  const end = new Date(start)

  // Add one month for the next period using UTC to avoid timezone issues
  end.setUTCMonth(end.getUTCMonth() + 1)

  logger.info('Calculated next billing period', {
    previousPeriodEnd: periodEnd,
    nextPeriodStart: start,
    nextPeriodEnd: end,
  })

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

      const billingPeriod = calculateBillingPeriod(
        subscriptionData[0]?.periodStart || undefined,
        subscriptionData[0]?.periodEnd || undefined
      )
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
 * Now properly calculates next period based on subscription billing cycle
 */
export async function resetUserBillingPeriod(userId: string): Promise<void> {
  try {
    // Get current period data and subscription info before reset
    const [currentStats, userSubscription] = await Promise.all([
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
      db
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))
        .limit(1),
    ])

    if (currentStats.length === 0) {
      logger.warn('No user stats found for billing period reset', { userId })
      return
    }

    const stats = currentStats[0]
    const currentPeriodCost = stats.currentPeriodCost || '0'

    // Calculate next billing period based on subscription or current period end
    let newPeriodStart: Date
    let newPeriodEnd: Date

    if (userSubscription.length > 0 && userSubscription[0].periodEnd) {
      // Use subscription-based period calculation
      const nextPeriod = calculateNextBillingPeriod(userSubscription[0].periodEnd)
      newPeriodStart = nextPeriod.start
      newPeriodEnd = nextPeriod.end
    } else if (stats.billingPeriodEnd) {
      // Use current billing period end to calculate next period
      const nextPeriod = calculateNextBillingPeriod(stats.billingPeriodEnd)
      newPeriodStart = nextPeriod.start
      newPeriodEnd = nextPeriod.end
    } else {
      // Fallback to subscription start date or default calculation
      const subscriptionStart = userSubscription[0]?.periodStart
      const billingPeriod = calculateBillingPeriod(subscriptionStart || undefined)
      newPeriodStart = billingPeriod.start
      newPeriodEnd = billingPeriod.end
    }

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
      basedOnSubscription: !!userSubscription[0]?.periodEnd,
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

    // Reset billing period for each member in parallel
    const memberUserIds = members.map((m) => m.userId)

    await Promise.all(
      memberUserIds.map(async (userId) => {
        try {
          await resetUserBillingPeriod(userId)
        } catch (error) {
          logger.error('Failed to reset billing period for organization member', {
            organizationId,
            userId,
            error,
          })
          // Don't throw - continue processing other members
        }
      })
    )

    logger.info('Reset billing period for organization', {
      organizationId,
      memberCount: members.length,
    })
  } catch (error) {
    logger.error('Failed to reset organization billing period', { organizationId, error })
    throw error
  }
}
