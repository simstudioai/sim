import { eq, inArray } from 'drizzle-orm'
import { getOrganizationSubscription, getPlanPricing } from '@/lib/billing/core/billing'
import { getUserUsageLimit } from '@/lib/billing/core/usage'
import { isBillingEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, organization, userStats } from '@/db/schema'

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
    // If billing is disabled, always return permissive limits
    if (!isBillingEnabled) {
      // Get actual usage from the database for display purposes
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const currentUsage =
        statsRecords.length > 0
          ? Number.parseFloat(statsRecords[0].currentPeriodCost?.toString())
          : 0

      return {
        percentUsed: Math.min(Math.round((currentUsage / 1000) * 100), 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: 1000,
      }
    }

    // Get usage limit from user_stats (per-user cap)
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
    const percentUsed = Math.min(Math.floor((currentUsage / limit) * 100), 100)

    // Check org-level cap for team/enterprise pooled usage
    let isExceeded = currentUsage >= limit
    let isWarning = percentUsed >= WARNING_THRESHOLD && percentUsed < 100
    try {
      const memberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))
      if (memberships.length > 0) {
        for (const m of memberships) {
          const orgRows = await db
            .select({ id: organization.id, orgUsageLimit: organization.orgUsageLimit })
            .from(organization)
            .where(eq(organization.id, m.organizationId))
            .limit(1)
          if (orgRows.length) {
            const org = orgRows[0]
            // Sum pooled usage
            const teamMembers = await db
              .select({ userId: member.userId })
              .from(member)
              .where(eq(member.organizationId, org.id))

            // Get all team member usage in a single query to avoid N+1
            let pooledUsage = 0
            if (teamMembers.length > 0) {
              const memberIds = teamMembers.map((tm) => tm.userId)
              const allMemberStats = await db
                .select({ current: userStats.currentPeriodCost, total: userStats.totalCost })
                .from(userStats)
                .where(inArray(userStats.userId, memberIds))

              for (const stats of allMemberStats) {
                pooledUsage += Number.parseFloat(
                  stats.current?.toString() || stats.total.toString()
                )
              }
            }
            // Determine org cap
            let orgCap = org.orgUsageLimit ? Number.parseFloat(String(org.orgUsageLimit)) : 0
            if (!orgCap || Number.isNaN(orgCap)) {
              // Fall back to minimum billing amount from Stripe subscription
              const orgSub = await getOrganizationSubscription(org.id)
              if (orgSub?.seats) {
                const { basePrice } = getPlanPricing(orgSub.plan)
                orgCap = (orgSub.seats || 1) * basePrice
              } else {
                // If no subscription, use team default
                const { basePrice } = getPlanPricing('team')
                orgCap = basePrice // Default to 1 seat minimum
              }
            }
            if (pooledUsage >= orgCap) {
              isExceeded = true
              isWarning = false
              break
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Error checking organization usage limits', { error, userId })
    }

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
    // Skip usage notifications if billing is disabled
    if (!isBillingEnabled) {
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
    // If billing is disabled, always allow execution
    if (!isBillingEnabled) {
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: 99999,
      }
    }

    logger.info('Server-side checking usage limits for user', { userId })

    // Hard block if billing is flagged as blocked
    const stats = await db
      .select({
        blocked: userStats.billingBlocked,
        current: userStats.currentPeriodCost,
        total: userStats.totalCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)
    if (stats.length > 0 && stats[0].blocked) {
      const currentUsage = Number.parseFloat(
        stats[0].current?.toString() || stats[0].total.toString()
      )
      return {
        isExceeded: true,
        currentUsage,
        limit: 0,
        message: 'Billing issue detected. Please update your payment method to continue.',
      }
    }

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
