import { db } from '@sim/db'
import { member, organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getUserUsageLimit } from '@/lib/billing/core/usage'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('UsageMonitor')

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
        percentUsed: Math.min((currentUsage / 1000) * 100, 100),
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
    const percentUsed = Math.min((currentUsage / limit) * 100, 100)

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
            // Determine org cap from orgUsageLimit (should always be set for team/enterprise)
            const orgCap = org.orgUsageLimit ? Number.parseFloat(String(org.orgUsageLimit)) : 0
            if (!orgCap || Number.isNaN(orgCap)) {
              logger.warn('Organization missing usage limit', { orgId: org.id })
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

    // Block execution if we can't determine usage status
    logger.error('Cannot determine usage status - blocking execution', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      percentUsed: 100,
      isWarning: false,
      isExceeded: true, // Block execution when we can't determine status
      currentUsage: 0,
      limit: 0, // Zero limit forces blocking
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
    if (!isBillingEnabled) {
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: 99999,
      }
    }

    logger.info('Server-side checking usage limits for user', { userId })

    // Check user's own blocked status
    const stats = await db
      .select({
        blocked: userStats.billingBlocked,
        blockedReason: userStats.billingBlockedReason,
        current: userStats.currentPeriodCost,
        total: userStats.totalCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const currentUsage =
      stats.length > 0
        ? Number.parseFloat(stats[0].current?.toString() || stats[0].total.toString())
        : 0

    if (stats.length > 0 && stats[0].blocked) {
      const message =
        stats[0].blockedReason === 'dispute'
          ? 'Account frozen. Please contact support to resolve this issue.'
          : 'Billing issue detected. Please update your payment method to continue.'
      return {
        isExceeded: true,
        currentUsage,
        limit: 0,
        message,
      }
    }

    // Check if user is in an org where the owner is blocked
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    for (const m of memberships) {
      // Find the owner of this org
      const owners = await db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, m.organizationId), eq(member.role, 'owner')))
        .limit(1)

      if (owners.length > 0) {
        const ownerStats = await db
          .select({
            blocked: userStats.billingBlocked,
            blockedReason: userStats.billingBlockedReason,
          })
          .from(userStats)
          .where(eq(userStats.userId, owners[0].userId))
          .limit(1)

        if (ownerStats.length > 0 && ownerStats[0].blocked) {
          const message =
            ownerStats[0].blockedReason === 'dispute'
              ? 'Organization account frozen. Please contact support to resolve this issue.'
              : 'Organization billing issue. Please contact your organization owner.'
          return {
            isExceeded: true,
            currentUsage,
            limit: 0,
            message,
          }
        }
      }
    }

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

    logger.error('Cannot determine usage limits - blocking execution', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      isExceeded: true, // Block execution when we can't determine limits
      currentUsage: 0,
      limit: 0, // Zero limit forces blocking
      message:
        error instanceof Error && error.message.includes('No user stats record found')
          ? 'User account not properly initialized. Please contact support.'
          : 'Unable to determine usage limits. Execution blocked for security. Please contact support.',
    }
  }
}
