import { db } from '@sim/db'
import { member, userStats, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getHighestPrioritySubscription,
  type HighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import { getPooledOrgCurrentPeriodCost, getUserUsageLimit } from '@/lib/billing/core/usage'
import { getBillingPeriodUsageCost } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  computeDailyRefreshConsumed,
  getOrgMemberRefreshBounds,
} from '@/lib/billing/credits/daily-refresh'
import {
  getOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage,
} from '@/lib/billing/organizations/member-limits'
import { getPlanTierDollars, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

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

  const billingPeriod =
    sub.periodStart && sub.periodEnd
      ? { start: sub.periodStart, end: sub.periodEnd }
      : defaultBillingPeriod()
  const ledgerUsage = await getBillingPeriodUsageCost(
    { type: 'organization', id: organizationId },
    billingPeriod
  )

  return applyOrgRefresh(organizationId, sub, currentPeriodCost + ledgerUsage, memberIds)
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

    if (subIsOrgScoped && sub) {
      const currentUsage = await computePooledOrgUsage(sub.referenceId, sub)
      return buildUsageData({ currentUsage, limit, scope, organizationId })
    }

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

    const billingPeriod =
      sub?.periodStart && sub.periodEnd
        ? { start: sub.periodStart, end: sub.periodEnd }
        : defaultBillingPeriod()
    const ledgerUsage = await getBillingPeriodUsageCost({ type: 'user', id: userId }, billingPeriod)
    let currentUsage = toNumber(toDecimal(statsRecords[0].currentPeriodCost)) + ledgerUsage
    if (sub && isPaid(sub.plan) && sub.periodStart) {
      const planDollars = getPlanTierDollars(sub.plan)
      if (planDollars > 0) {
        const refresh = await computeDailyRefreshConsumed({
          userIds: [userId],
          periodStart: sub.periodStart,
          periodEnd: sub.periodEnd ?? null,
          planDollars,
          billingEntity: { type: 'user', id: userId },
        })
        currentUsage = Math.max(0, currentUsage - refresh)
      }
    }

    return buildUsageData({ currentUsage, limit, scope, organizationId })
  } catch (error) {
    logger.error('Error checking usage status', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      userId,
    })

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

async function applyOrgRefresh(
  organizationId: string,
  sub: {
    plan: string | null
    seats: number | null
    periodStart: Date | null
    periodEnd: Date | null
  },
  currentUsage: number,
  preloadedMemberIds?: string[]
): Promise<number> {
  if (!isPaid(sub.plan) || !sub.periodStart) {
    return currentUsage
  }

  const memberIds =
    preloadedMemberIds ?? (await getPooledOrgCurrentPeriodCost(organizationId)).memberIds
  if (memberIds.length === 0) return currentUsage

  const planDollars = getPlanTierDollars(sub.plan)
  if (planDollars <= 0) return currentUsage

  const userBounds = await getOrgMemberRefreshBounds(organizationId, sub.periodStart)
  const refresh = await computeDailyRefreshConsumed({
    userIds: memberIds,
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd ?? null,
    planDollars,
    seats: sub.seats || 1,
    userBounds: Object.keys(userBounds).length > 0 ? userBounds : undefined,
    billingEntity: { type: 'organization', id: organizationId },
  })

  return Math.max(0, currentUsage - refresh)
}

function buildUsageData(params: {
  currentUsage: number
  limit: number
  scope: 'user' | 'organization'
  organizationId: string | null
}): UsageData {
  const { currentUsage, limit, scope, organizationId } = params
  const percentUsed = limit > 0 ? Math.min((currentUsage / limit) * 100, 100) : 100
  const isExceeded = currentUsage >= limit
  const isWarning = !isExceeded && percentUsed >= WARNING_THRESHOLD

  logger.info('Final usage statistics', {
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
}

/**
 * Displays a notification to the user when they're approaching their usage limit
 * Can be called on app startup or before executing actions that might incur costs
 */
async function checkAndNotifyUsage(userId: string): Promise<void> {
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
 * Whether an account (or its organization owner) is billing-blocked — frozen for
 * a dispute or flagged for a payment issue. Independent of usage limits, so it can
 * gate paths that are otherwise exempt from metered caps (e.g. BYOK wand): a
 * frozen account is locked out everywhere.
 */
export async function checkBillingBlocked(
  userId: string
): Promise<{ blocked: boolean; message?: string }> {
  const stats = await db
    .select({ blocked: userStats.billingBlocked, blockedReason: userStats.billingBlockedReason })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (stats.length > 0 && stats[0].blocked) {
    return {
      blocked: true,
      message:
        stats[0].blockedReason === 'dispute'
          ? 'Account frozen. Please contact support to resolve this issue.'
          : 'Billing issue detected. Please update your payment method to continue.',
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
        return {
          blocked: true,
          message:
            ownerStats[0].blockedReason === 'dispute'
              ? 'Organization account frozen. Please contact support to resolve this issue.'
              : 'Organization billing issue. Please contact your organization owner.',
        }
      }
    }
  }

  return { blocked: false }
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
      .select({ current: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    const currentUsage = stats.length > 0 ? toNumber(toDecimal(stats[0].current)) : 0

    const blocked = await checkBillingBlocked(userId)
    if (blocked.blocked) {
      return { isExceeded: true, currentUsage, limit: 0, message: blocked.message }
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

/**
 * Per-member usage cap for the organization that owns the given workspace.
 *
 * Hosted-only and independent of the pooled org limit
 * ({@link checkServerSideUsageLimits}). No-ops (isExceeded:false) when the
 * feature is off (`!isHosted` / `!isBillingEnabled`), the workspace is not
 * org-owned, or the actor has no per-member cap. Otherwise compares the actor's
 * current-period usage inside the org's workspaces against their cap
 * (`usage >= limit` blocks).
 *
 * Fails open on unexpected error: this is a secondary, additive gate, so a
 * transient fault must not block execution that the primary pooled/personal
 * check already allowed.
 */
export async function checkOrgMemberUsageLimit(
  userId: string,
  workspaceId: string
): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number | null
  message?: string
}> {
  try {
    if (!isHosted || !isBillingEnabled || !workspaceId) {
      return { isExceeded: false, currentUsage: 0, limit: null }
    }

    const [workspaceRow] = await db
      .select({ organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    const organizationId = workspaceRow?.organizationId
    if (!organizationId) {
      return { isExceeded: false, currentUsage: 0, limit: null }
    }

    // Resolve the cap first and short-circuit when unset (the common case); only
    // then is computing usage worthwhile. Kept sequential, not raced, to avoid a
    // usage query on every uncapped member's execution.
    const limit = await getOrgMemberUsageLimit(organizationId, userId)
    if (limit === null) {
      return { isExceeded: false, currentUsage: 0, limit: null }
    }

    const usage = await getOrgMemberWorkspaceUsage(organizationId, userId)
    const isExceeded = usage >= limit

    return {
      isExceeded,
      currentUsage: usage,
      limit,
      message: isExceeded
        ? `Member credit limit exceeded: ${dollarsToCredits(usage).toLocaleString()} of ${dollarsToCredits(limit).toLocaleString()} credits used for this organization's workspaces. Ask an organization admin to raise your credit limit to continue.`
        : undefined,
    }
  } catch (error) {
    logger.error('Error checking per-member org usage limit', {
      error: toError(error).message,
      userId,
      workspaceId,
    })
    return { isExceeded: false, currentUsage: 0, limit: null }
  }
}

/**
 * Unified usage gate for an actor: the pooled/personal cap first
 * ({@link checkServerSideUsageLimits}), then the per-member org-workspace cap
 * ({@link checkOrgMemberUsageLimit}) when a workspace is in scope. Returns the
 * first exceeded result so every billable surface (workflow exec, copilot,
 * voice, wand, enrichment, KB indexing) can gate on a single
 * `{ isExceeded, message }`. `scope` distinguishes a pooled cap from a per-member
 * cap so clients can hide an "Upgrade" affordance a capped member can't act on (a
 * per-member cap is only raisable by an org admin).
 */
export async function checkActorUsageLimits(
  userId: string,
  workspaceId?: string | null
): Promise<{ isExceeded: boolean; message?: string; scope?: 'pooled' | 'member' }> {
  const pooled = await checkServerSideUsageLimits(userId)
  if (pooled.isExceeded) {
    return { isExceeded: true, message: pooled.message, scope: 'pooled' }
  }

  if (workspaceId) {
    const member = await checkOrgMemberUsageLimit(userId, workspaceId)
    if (member.isExceeded) {
      return { isExceeded: true, message: member.message, scope: 'member' }
    }
  }

  return { isExceeded: false }
}
