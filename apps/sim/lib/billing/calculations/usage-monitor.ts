import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { resolveSubscriptionUsagePeriod } from '@/lib/billing/core/reporting-period'
import { getUserUsageLimit, type UsageLimitSubscription } from '@/lib/billing/core/usage'
import {
  type BillingContext,
  type BillingEntity,
  getBillingPeriodUsageCost,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { computeBillingPeriodUsageWithWeeklyRefresh } from '@/lib/billing/credits/weekly-refresh'
import {
  getOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'
import { getPlanWeeklyRefreshDollars, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
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
  sub: UsageLimitSubscription,
  preloadedBillingPeriod?: UsageQueryPeriod
): Promise<number> {
  const billingPeriod = preloadedBillingPeriod ??
    resolveSubscriptionUsagePeriod(sub) ?? {
      ...defaultBillingPeriod(),
      source: 'default' as const,
      anchorDate: null,
      interval: null,
    }

  if (!isPaid(sub.plan) || !sub.periodStart) {
    return getBillingPeriodUsageCost({ type: 'organization', id: organizationId }, billingPeriod)
  }

  const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(sub.plan)
  if (weeklyRefreshDollars <= 0) {
    return getBillingPeriodUsageCost({ type: 'organization', id: organizationId }, billingPeriod)
  }

  const { ledgerUsage, refreshConsumed } = await computeBillingPeriodUsageWithWeeklyRefresh({
    billingEntity: { type: 'organization', id: organizationId },
    billingPeriod,
    refreshPeriodStart: sub.periodStart,
    refreshPeriodEnd: sub.periodEnd ?? null,
    weeklyRefreshDollars,
    seats: sub.seats || 1,
  })

  return Math.max(0, ledgerUsage - refreshConsumed)
}

/**
 * Checks a user's cost usage against their subscription plan limit
 * and returns usage information including whether they're approaching the limit
 */
export async function checkUsageStatus(
  userId: string,
  preloadedSubscription?: UsageLimitSubscription | null,
  preloadedBillingContext?: BillingContext
): Promise<UsageData> {
  try {
    if (!isBillingEnabled) {
      // Self-hosted display: lifetime ledger over the open default window.
      const currentUsage = await getBillingPeriodUsageCost(
        { type: 'user', id: userId },
        { ...defaultBillingPeriod(), source: 'default' }
      )

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
      const currentUsage = await computePooledOrgUsage(
        sub.referenceId,
        sub,
        preloadedBillingContext?.billingPeriod
      )
      return buildUsageData({ currentUsage, limit, scope, organizationId })
    }

    const billingPeriod =
      preloadedBillingContext?.billingPeriod ??
      (sub?.periodStart && sub.periodEnd
        ? { start: sub.periodStart, end: sub.periodEnd }
        : defaultBillingPeriod())
    let ledgerUsage: number
    let refreshConsumed = 0
    let appliedWeeklyRefresh = false
    if (sub && isPaid(sub.plan) && sub.periodStart) {
      const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(sub.plan)
      if (weeklyRefreshDollars > 0) {
        const usage = await computeBillingPeriodUsageWithWeeklyRefresh({
          billingEntity: { type: 'user', id: userId },
          billingPeriod,
          refreshPeriodStart: sub.periodStart,
          refreshPeriodEnd: sub.periodEnd ?? null,
          weeklyRefreshDollars,
        })
        ledgerUsage = usage.ledgerUsage
        refreshConsumed = usage.refreshConsumed
        appliedWeeklyRefresh = true
      } else {
        ledgerUsage = await getBillingPeriodUsageCost({ type: 'user', id: userId }, billingPeriod)
      }
    } else {
      ledgerUsage = await getBillingPeriodUsageCost({ type: 'user', id: userId }, billingPeriod)
    }
    const usageBeforeRefresh = ledgerUsage - refreshConsumed
    const currentUsage = appliedWeeklyRefresh ? Math.max(0, usageBeforeRefresh) : usageBeforeRefresh

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
 * Whether the exact hosted user account is billing-blocked. Organization
 * memberships are deliberately ignored; workspace payer checks are separate.
 */
export async function checkBillingBlocked(
  userId: string
): Promise<{ blocked: boolean; message?: string }> {
  if (!isHosted || !isBillingEnabled) {
    return { blocked: false }
  }

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

  return { blocked: false }
}

/**
 * Checks only the exact immutable payer selected by a billing attribution.
 *
 * Organization checks are scoped to that organization owner, while personal
 * checks read only that billed user. Actor memberships are never consulted.
 */
export async function checkBillingEntityBlocked(
  billingEntity: BillingEntity
): Promise<{ blocked: boolean; message?: string }> {
  if (!isHosted || !isBillingEnabled) {
    return { blocked: false }
  }

  if (billingEntity.type === 'organization') {
    const blocked = await isOrganizationBillingBlocked(billingEntity.id)
    return blocked
      ? {
          blocked: true,
          message: 'Organization billing issue. Please contact your organization owner.',
        }
      : { blocked: false }
  }

  const [stats] = await db
    .select({
      blocked: userStats.billingBlocked,
      blockedReason: userStats.billingBlockedReason,
    })
    .from(userStats)
    .where(eq(userStats.userId, billingEntity.id))
    .limit(1)

  if (!stats?.blocked) return { blocked: false }

  return {
    blocked: true,
    message:
      stats.blockedReason === 'dispute'
        ? 'Account frozen. Please contact support to resolve this issue.'
        : 'Billing issue detected. Please update your payment method to continue.',
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
  preloadedSubscription?: UsageLimitSubscription | null,
  preloadedBillingContext?: BillingContext
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

    const blocked = await checkBillingBlocked(userId)
    if (blocked.blocked) {
      // Enforcement stays blocked, but surfaced usage must be the real ledger
      // value — `/api/users/me/usage-limits` exposes it as `currentPeriodCost`.
      const sub =
        preloadedSubscription !== undefined
          ? preloadedSubscription
          : await getHighestPrioritySubscription(userId)
      const subIsOrgScoped = isOrgScopedSubscription(sub, userId)
      const billingEntity: BillingEntity =
        subIsOrgScoped && sub
          ? { type: 'organization', id: sub.referenceId }
          : { type: 'user', id: userId }
      const billingPeriod = preloadedBillingContext?.billingPeriod ??
        resolveSubscriptionUsagePeriod(sub) ?? { ...defaultBillingPeriod(), source: 'default' }
      const currentUsage = await getBillingPeriodUsageCost(billingEntity, billingPeriod)
      return { isExceeded: true, currentUsage, limit: 0, message: blocked.message }
    }

    const usageData = await checkUsageStatus(userId, preloadedSubscription, preloadedBillingContext)

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
 * Per-member usage cap for an exact `(organizationId, actorUserId)` pair.
 *
 * Hosted-only and independent of the pooled org limit
 * ({@link checkServerSideUsageLimits}). The actor need not have an organization
 * member row; configured limits are keyed directly by organization and user.
 *
 * Fails open on unexpected error: this is a secondary, additive gate, so a
 * transient fault must not block execution that the primary pooled/personal
 * check already allowed.
 */
export async function checkOrganizationMemberUsageLimit(
  userId: string,
  organizationId: string,
  billingPeriod: UsageQueryPeriod
): Promise<OrganizationMemberUsageLimitResult> {
  try {
    if (!isHosted || !isBillingEnabled || !organizationId) {
      return { isExceeded: false, currentUsage: 0, limit: null }
    }

    return await evaluateOrganizationMemberUsageLimit(organizationId, userId, () =>
      getOrgMemberUsageForBillingPeriod(organizationId, userId, billingPeriod)
    )
  } catch (error) {
    logger.error('Error checking per-member org usage limit', {
      error: toError(error).message,
      userId,
      organizationId,
    })
    return { isExceeded: false, currentUsage: 0, limit: null }
  }
}

interface OrganizationMemberUsageLimitResult {
  isExceeded: boolean
  currentUsage: number
  limit: number | null
  message?: string
}

async function evaluateOrganizationMemberUsageLimit(
  organizationId: string,
  userId: string,
  getUsage: () => Promise<number>
): Promise<OrganizationMemberUsageLimitResult> {
  const limit = await getOrgMemberUsageLimit(organizationId, userId)
  if (limit === null) {
    return { isExceeded: false, currentUsage: 0, limit: null }
  }

  const usage = await getUsage()
  const isExceeded = usage >= limit

  return {
    isExceeded,
    currentUsage: usage,
    limit,
    message: isExceeded
      ? `Member credit limit exceeded: ${dollarsToCredits(usage).toLocaleString()} of ${dollarsToCredits(limit).toLocaleString()} credits used for this organization's workspaces. Ask an organization admin to raise your credit limit to continue.`
      : undefined,
  }
}

/**
 * Account-scoped usage gate for operations without a workspace payer.
 *
 * Workspace-hosted operations must resolve a billing attribution snapshot and
 * use `checkAttributedUsageLimits` so the workspace payer pool and exact
 * `(organizationId, actorUserId)` member cap are enforced.
 */
export async function checkActorUsageLimits(
  userId: string
): Promise<{ isExceeded: boolean; message?: string; scope?: 'pooled' | 'member' }> {
  const pooled = await checkServerSideUsageLimits(userId)
  if (pooled.isExceeded) {
    return { isExceeded: true, message: pooled.message, scope: 'pooled' }
  }

  return { isExceeded: false }
}
