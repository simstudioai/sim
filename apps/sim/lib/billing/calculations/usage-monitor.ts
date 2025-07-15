import { eq } from 'drizzle-orm'
import { getUserUsageLimit } from '@/lib/billing/core/usage'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { userStats } from '@/db/schema'

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
        statsRecords.length > 0
          ? Number.parseFloat(
              statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
            )
          : 0

      return {
        percentUsed: Math.min(Math.round((currentUsage / 1000) * 100), 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: 1000,
      }
    }

    // Get usage limit from user_stats (new method)
    const limit = await getUserUsageLimit(userId)
    logger.info('Using stored usage limit', { userId, limit })

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

    // Get the current period cost from the user stats (use currentPeriodCost if available, fallback to totalCost)
    const currentUsage = Number.parseFloat(
      statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
    )

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
        ? `Usage limit exceeded: ${usageData.currentUsage?.toFixed(2) || 0}$ used of ${usageData.limit?.toFixed(2) || 0}$ limit. Please upgrade your plan to continue.`
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
