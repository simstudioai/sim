import { eq } from 'drizzle-orm'
import { isProd } from '@/lib/environment'
import { db } from '@/db'
import { member, organization as organizationTable, subscription, userStats } from '@/db/schema'
import { createLogger } from './logs/console-logger'
import { isProPlan, isTeamPlan } from './subscription'

const logger = createLogger('UsageMonitor')

// Percentage threshold for showing warning
const WARNING_THRESHOLD = 80

interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  currentUsage: number
  limit: number
}

/**
 * Gets the number of seats for a team subscription
 * Used to calculate usage limits for team plans
 */
async function getTeamSeats(userId: string): Promise<number> {
  try {
    // First check if user is part of an organization with a team subscription
    const memberships = await db.select().from(member).where(eq(member.userId, userId)).limit(1)

    if (memberships.length > 0) {
      const orgId = memberships[0].organizationId

      // Check for organization's team subscription
      const orgSubscriptions = await db
        .select()
        .from(subscription)
        .where(eq(subscription.referenceId, orgId))

      const teamSubscription = orgSubscriptions.find(
        (sub) => sub.status === 'active' && sub.plan === 'team'
      )

      if (teamSubscription?.seats) {
        logger.info('Found organization team subscription with seats', {
          userId,
          orgId,
          seats: teamSubscription.seats,
        })
        return teamSubscription.seats
      }
    }

    // If no organization team subscription, check for personal team subscription
    const userSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, userId))

    const teamSubscription = userSubscriptions.find(
      (sub) => sub.status === 'active' && sub.plan === 'team'
    )

    if (teamSubscription?.seats) {
      logger.info('Found personal team subscription with seats', {
        userId,
        seats: teamSubscription.seats,
      })
      return teamSubscription.seats
    }

    // Default to 10 seats if we know they're on a team plan but couldn't get seats info
    return 10
  } catch (error) {
    logger.error('Error getting team seats', { error, userId })
    // Default to 10 seats on error
    return 10
  }
}

/**
 * Checks a user's cost usage against their subscription plan limit
 * and returns usage information including whether they're approaching the limit
 */
export async function checkUsageStatus(userId: string): Promise<UsageData> {
  try {
    // In development, always return permissive limits
    if (!isProd) {
      // Get actual usage from the database for display purposes
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const currentUsage =
        statsRecords.length > 0 ? parseFloat(statsRecords[0].totalCost.toString()) : 0

      return {
        percentUsed: Math.min(Math.round((currentUsage / 1000) * 100), 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: 1000,
      }
    }

    // Production environment - check real subscription limits

    // Get user's subscription details
    const isPro = await isProPlan(userId)
    const isTeam = await isTeamPlan(userId)

    logger.info('User subscription status', { userId, isPro, isTeam })

    // Determine the limit based on subscription type
    let limit: number

    if (isTeam) {
      // For team plans, get the number of seats and multiply by per-seat limit
      const teamSeats = await getTeamSeats(userId)
      const perSeatLimit = process.env.TEAM_TIER_COST_LIMIT
        ? parseFloat(process.env.TEAM_TIER_COST_LIMIT)
        : 40

      limit = perSeatLimit * teamSeats

      logger.info('Using team plan limit', {
        userId,
        seats: teamSeats,
        perSeatLimit,
        totalLimit: limit,
      })
    } else if (isPro) {
      // Pro plan has a fixed limit
      limit = process.env.PRO_TIER_COST_LIMIT ? parseFloat(process.env.PRO_TIER_COST_LIMIT) : 20

      logger.info('Using pro plan limit', { userId, limit })
    } else {
      // Free tier limit
      limit = process.env.FREE_TIER_COST_LIMIT ? parseFloat(process.env.FREE_TIER_COST_LIMIT) : 5

      logger.info('Using free tier limit', { userId, limit })
    }

    // Get actual usage from the database
    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    // If no stats record exists, create a default one
    if (statsRecords.length === 0) {
      logger.info('No usage stats found for user', { userId, limit })

      return {
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        currentUsage: 0,
        limit,
      }
    }

    // Get the current cost from the user stats
    const currentUsage = parseFloat(statsRecords[0].totalCost.toString())

    // Calculate percentage used
    const percentUsed = Math.min(Math.round((currentUsage / limit) * 100), 100)

    // Check if usage exceeds threshold or limit
    const isWarning = percentUsed >= WARNING_THRESHOLD && percentUsed < 100
    const isExceeded = currentUsage >= limit

    logger.info('Final usage statistics', {
      userId,
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
    })

    return {
      percentUsed,
      isWarning,
      isExceeded,
      currentUsage,
      limit,
    }
  } catch (error) {
    logger.error('Error checking usage status', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    // Return default values in case of error
    return {
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      currentUsage: 0,
      limit: 0,
    }
  }
}

/**
 * Displays a notification to the user when they're approaching their usage limit
 * Can be called on app startup or before executing actions that might incur costs
 */
export async function checkAndNotifyUsage(userId: string): Promise<void> {
  try {
    // Skip usage notifications in development
    if (!isProd) {
      return
    }

    const usageData = await checkUsageStatus(userId)

    if (usageData.isExceeded) {
      // User has exceeded their limit
      logger.warn('User has exceeded usage limits', {
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit,
      })

      // Dispatch event to show a UI notification
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('usage-exceeded', {
            detail: { usageData },
          })
        )
      }
    } else if (usageData.isWarning) {
      // User is approaching their limit
      logger.info('User approaching usage limits', {
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit,
        percent: usageData.percentUsed,
      })

      // Dispatch event to show a UI notification
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('usage-warning', {
            detail: { usageData },
          })
        )

        // Optionally open the subscription tab in settings
        window.dispatchEvent(
          new CustomEvent('open-settings', {
            detail: { tab: 'subscription' },
          })
        )
      }
    }
  } catch (error) {
    logger.error('Error in usage notification system', { error, userId })
  }
}

/**
 * Server-side function to check if a user has exceeded their usage limits
 * For use in API routes, webhooks, and scheduled executions
 *
 * @param userId The ID of the user to check
 * @returns An object containing the exceeded status and usage details
 */
export async function checkServerSideUsageLimits(userId: string): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number
  message?: string
}> {
  try {
    // In development, always allow execution
    if (!isProd) {
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: 1000,
      }
    }

    logger.info('Server-side checking usage limits for user', { userId })

    // Get usage data using the same function we use for client-side
    const usageData = await checkUsageStatus(userId)

    return {
      isExceeded: usageData.isExceeded,
      currentUsage: usageData.currentUsage,
      limit: usageData.limit,
      message: usageData.isExceeded
        ? `Usage limit exceeded: ${usageData.currentUsage.toFixed(2)}$ used of ${usageData.limit}$ limit. Please upgrade your plan to continue.`
        : undefined,
    }
  } catch (error) {
    logger.error('Error in server-side usage limit check', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    // Be conservative in case of error - allow execution but log the issue
    return {
      isExceeded: false,
      currentUsage: 0,
      limit: 0,
      message: `Error checking usage limits: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
