import { db } from '@sim/db'
import { member, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import {
  getHighestPrioritySubscription,
  type HighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import { getPooledOrgCurrentPeriodCost, getUserUsageLimit } from '@/lib/billing/core/usage'
import {
  computeDailyRefreshConsumed,
  getOrgMemberRefreshBounds,
} from '@/lib/billing/credits/daily-refresh'
import { getPlanTierDollars, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('UsageMonitor')

const WARNING_THRESHOLD = 80

interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  currentUsage: number
  limit: number
  /**
   * Whether the returned values are this user's individual slice or the
   * organization's pooled total/cap. When an org pool is the blocker,
   * the pooled values are surfaced here so error messages reflect it.
   */
  scope: 'user' | 'organization'
  /** Present only when `scope === 'organization'`. */
  organizationId: string | null
}

/**
 * Sum `currentPeriodCost` across all members of an org, then subtract
 * daily-refresh credits (with per-user window bounds for mid-cycle
 * joiners).
 */
async function computePooledOrgUsage(
  organizationId: string,
  sub: {
    plan: string | null
    seats: number | null
    periodStart: Date | null
    periodEnd: Date | null
  }
): Promise<number> {
  const { memberIds, currentPeriodCost } = await getPooledOrgCurrentPeriodCost(organizationId)
  if (memberIds.length === 0) return 0

  let pooled = currentPeriodCost

  if (isPaid(sub.plan) && sub.periodStart) {
    const planDollars = getPlanTierDollars(sub.plan)
    if (planDollars > 0) {
      const userBounds = await getOrgMemberRefreshBounds(organizationId, sub.periodStart)
      const refresh = await computeDailyRefreshConsumed({
        userIds: memberIds,
        periodStart: sub.periodStart,
        periodEnd: sub.periodEnd ?? null,
        planDollars,
        seats: sub.seats || 1,
        userBounds: Object.keys(userBounds).length > 0 ? userBounds : undefined,
      })
      pooled = Math.max(0, pooled - refresh)
    }
  }

  return pooled
}

/**
 * Checks a user's cost usage against their subscription plan limit
 * and returns usage information including whether they're approaching the limit
 */
export async function checkUsageStatus(
  userId: string,
  preloadedSubscription?: HighestPrioritySubscription
): Promise<UsageData> {
  try {
    if (!isBillingEnabled) {
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const currentUsage =
        statsRecords.length > 0 ? toNumber(toDecimal(statsRecords[0].currentPeriodCost)) : 0

      return {
        percentUsed: Math.min((currentUsage / 1000) * 100, 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: 1000,
        scope: 'user',
        organizationId: null,
      }
    }

    const sub =
      preloadedSubscription !== undefined
        ? preloadedSubscription
        : await getHighestPrioritySubscription(userId)

    const limit = await getUserUsageLimit(userId, sub)
    logger.info('Using stored usage limit', { userId, limit })

    const subIsOrgScoped = isOrgScopedSubscription(sub, userId)
    const scope: 'user' | 'organization' = subIsOrgScoped ? 'organization' : 'user'
    const organizationId: string | null = subIsOrgScoped && sub ? sub.referenceId : null

    let currentUsage = 0

    if (subIsOrgScoped && sub) {
      currentUsage = await computePooledOrgUsage(sub.referenceId, sub)
    } else {
      const statsRecords = await db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1)

      if (statsRecords.length === 0) {
        logger.info('No usage stats found for user', { userId, limit })
        return {
          percentUsed: 0,
          isWarning: false,
          isExceeded: false,
          currentUsage: 0,
          limit,
          scope: 'user',
          organizationId: null,
        }
      }

      const rawUsage = toNumber(toDecimal(statsRecords[0].currentPeriodCost))

      let refresh = 0
      if (sub && isPaid(sub.plan) && sub.periodStart) {
        const planDollars = getPlanTierDollars(sub.plan)
        if (planDollars > 0) {
          refresh = await computeDailyRefreshConsumed({
            userIds: [userId],
            periodStart: sub.periodStart,
            periodEnd: sub.periodEnd ?? null,
            planDollars,
          })
        }
      }
      currentUsage = Math.max(0, rawUsage - refresh)
    }

    const percentUsed = limit > 0 ? Math.min((currentUsage / limit) * 100, 100) : 100
    const isExceeded = currentUsage >= limit
    const isWarning = !isExceeded && percentUsed >= WARNING_THRESHOLD

    logger.info('Final usage statistics', {
      userId,
      currentUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
      scope,
      organizationId,
    })

    return {
      percentUsed,
      isWarning,
      isExceeded,
      currentUsage,
      limit,
      scope,
      organizationId,
    }
  } catch (error) {
    logger.error('Error checking usage status', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    // Block execution if we can't determine usage status
    logger.error('Cannot determine usage status - blocking execution', {
      userId,
      error: toError(error).message,
    })

    return {
      percentUsed: 100,
      isWarning: false,
      isExceeded: true,
      currentUsage: 0,
      limit: 0,
      scope: 'user',
      organizationId: null,
    }
  }
}

/**
 * Displays a notification to the user when they're approaching their usage limit
 * Can be called on app startup or before executing actions that might incur costs
 */
export async function checkAndNotifyUsage(userId: string): Promise<void> {
  try {
    if (!isBillingEnabled) {
      return
    }

    const usageData = await checkUsageStatus(userId)

    if (usageData.isExceeded) {
      logger.warn('User has exceeded usage limits', {
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit,
      })

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('usage-exceeded', {
            detail: { usageData },
          })
        )
      }
    } else if (usageData.isWarning) {
      logger.info('User approaching usage limits', {
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit,
        percent: usageData.percentUsed,
      })

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('usage-warning', {
            detail: { usageData },
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
export async function checkServerSideUsageLimits(
  userId: string,
  preloadedSubscription?: HighestPrioritySubscription
): Promise<{
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

    const stats = await db
      .select({
        blocked: userStats.billingBlocked,
        blockedReason: userStats.billingBlockedReason,
        current: userStats.currentPeriodCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const currentUsage = stats.length > 0 ? toNumber(toDecimal(stats[0].current)) : 0

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

    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    for (const m of memberships) {
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

    const usageData = await checkUsageStatus(userId, preloadedSubscription)

    const formattedUsage = (usageData.currentUsage ?? 0).toFixed(2)
    const formattedLimit = (usageData.limit ?? 0).toFixed(2)
    const exceededMessage =
      usageData.scope === 'organization'
        ? `Organization usage limit exceeded: $${formattedUsage} pooled of $${formattedLimit} organization limit. Ask a team admin to raise the organization usage limit to continue.`
        : `Usage limit exceeded: $${formattedUsage} used of $${formattedLimit} limit. Please upgrade your plan or raise your usage limit to continue.`

    return {
      isExceeded: usageData.isExceeded,
      currentUsage: usageData.currentUsage,
      limit: usageData.limit,
      message: usageData.isExceeded ? exceededMessage : undefined,
    }
  } catch (error) {
    logger.error('Error in server-side usage limit check', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

    logger.error('Cannot determine usage limits - blocking execution', {
      userId,
      error: toError(error).message,
    })

    return {
      isExceeded: true,
      currentUsage: 0,
      limit: 0,
      message:
        error instanceof Error && error.message.includes('No user stats record found')
          ? 'User account not properly initialized. Please contact support.'
          : 'Unable to determine usage limits. Execution blocked for security. Please contact support.',
    }
  }
}
