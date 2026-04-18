import { db } from '@sim/db'
import { member, organization, settings, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  getEmailSubject,
  renderCreditsExhaustedEmail,
  renderFreeTierUpgradeEmail,
  renderUsageThresholdEmail,
} from '@/components/emails'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import {
  getHighestPrioritySubscription,
  type HighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import {
  computeDailyRefreshConsumed,
  getOrgMemberRefreshBounds,
} from '@/lib/billing/credits/daily-refresh'
import { getPlanTierDollars, isEnterprise, isFree, isPaid, isPro } from '@/lib/billing/plan-helpers'
import {
  canEditUsageLimit,
  getFreeTierLimit,
  getPerUserMinimumLimit,
  getPlanPricing,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import type { BillingData, UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { Decimal, toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateId } from '@/lib/core/utils/uuid'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getEmailPreferences } from '@/lib/messaging/email/unsubscribe'

const logger = createLogger('UsageManagement')

export interface OrgUsageLimitResult {
  limit: number
  minimum: number
}

/**
 * Sum `currentPeriodCost` across all members of an organization.
 * The single source of truth for pooled-usage reads so every caller
 * applies identical null-handling and query shape. Does NOT apply
 * daily-refresh deduction — callers layer that on top themselves
 * because refresh math needs the caller's `sub` context (plan,
 * period, seats, per-user bounds).
 *
 * Uses `LEFT JOIN` so members whose `userStats` row is missing still
 * appear (contributing 0), which keeps `memberIds` complete for
 * downstream refresh / bounds computations.
 */
export async function getPooledOrgCurrentPeriodCost(
  organizationId: string
): Promise<{ memberIds: string[]; currentPeriodCost: number }> {
  const rows = await db
    .select({
      userId: member.userId,
      currentPeriodCost: userStats.currentPeriodCost,
    })
    .from(member)
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))

  let pooled = new Decimal(0)
  const memberIds: string[] = []
  for (const row of rows) {
    memberIds.push(row.userId)
    pooled = pooled.plus(toDecimal(row.currentPeriodCost))
  }

  return { memberIds, currentPeriodCost: toNumber(pooled) }
}

/**
 * Calculates the effective usage limit for an organization-scoped plan.
 * Enterprise uses the configured orgUsageLimit directly; every other
 * paid plan uses `basePrice × seats` (Stripe's `price × quantity`) as a
 * floor. Returns `{ limit, minimum }` where `limit = max(configured, minimum)`.
 */
export async function getOrgUsageLimit(
  organizationId: string,
  plan: string,
  seats: number | null
): Promise<OrgUsageLimitResult> {
  const orgData = await db
    .select({ orgUsageLimit: organization.orgUsageLimit })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  const configured =
    orgData.length > 0 && orgData[0].orgUsageLimit
      ? toNumber(toDecimal(orgData[0].orgUsageLimit))
      : null

  if (isEnterprise(plan)) {
    // Enterprise: Use configured limit directly (no per-seat minimum)
    if (configured !== null) {
      return { limit: configured, minimum: configured }
    }
    logger.warn('Enterprise org missing usage limit', { orgId: organizationId })
    return { limit: 0, minimum: 0 }
  }

  const { basePrice } = getPlanPricing(plan)
  // `||` not `??` — 0 is never a valid seat count for a paid sub.
  const seatCount = seats || 1
  const minimum = seatCount * basePrice

  if (configured !== null) {
    return { limit: Math.max(configured, minimum), minimum }
  }

  logger.warn('Org missing usage limit, using plan-driven minimum as fallback', {
    orgId: organizationId,
    plan,
    seats: seatCount,
    minimum,
  })
  return { limit: minimum, minimum }
}

/**
 * Handle new user setup when they join the platform
 * Creates userStats record with default free credits
 */
export async function handleNewUser(userId: string): Promise<void> {
  try {
    await db.insert(userStats).values({
      id: generateId(),
      userId: userId,
      currentUsageLimit: getFreeTierLimit().toString(),
      usageLimitUpdatedAt: new Date(),
    })

    logger.info('User stats record created for new user', { userId })
  } catch (error) {
    logger.error('Failed to create user stats record for new user', {
      userId,
      error,
    })
    throw error
  }
}

/**
 * Ensures a userStats record exists for a user.
 * Creates one with default values if missing.
 * This is a fallback for cases where the user.create.after hook didn't fire
 * (e.g., OAuth account linking to existing users).
 *
 */
export async function ensureUserStatsExists(userId: string): Promise<void> {
  await db
    .insert(userStats)
    .values({
      id: generateId(),
      userId: userId,
      currentUsageLimit: getFreeTierLimit().toString(),
      usageLimitUpdatedAt: new Date(),
    })
    .onConflictDoNothing({ target: userStats.userId })
}

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(userId: string): Promise<UsageData> {
  try {
    await ensureUserStatsExists(userId)

    const [userStatsData, subscription] = await Promise.all([
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
      getHighestPrioritySubscription(userId),
    ])

    if (userStatsData.length === 0) {
      logger.error('User stats not found for userId', { userId })
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsData[0]
    const orgScoped = isOrgScopedSubscription(subscription, userId)

    let currentUsageDecimal = toDecimal(stats.currentPeriodCost)

    // For personally-scoped Pro users, include any snapshotted usage from
    // a prior org-join so the display reflects their total Pro usage.
    if (subscription && isPro(subscription.plan) && !orgScoped) {
      const snapshotUsageDecimal = toDecimal(stats.proPeriodCostSnapshot)
      if (snapshotUsageDecimal.greaterThan(0)) {
        currentUsageDecimal = currentUsageDecimal.plus(snapshotUsageDecimal)
        logger.info('Including Pro snapshot in usage display', {
          userId,
          currentPeriodCost: stats.currentPeriodCost,
          proPeriodCostSnapshot: toNumber(snapshotUsageDecimal),
          totalUsage: toNumber(currentUsageDecimal),
        })
      }
    }
    let currentUsage = toNumber(currentUsageDecimal)

    let limit: number
    // Shared between the pooled-usage and pooled-refresh blocks so we
    // don't issue the member lookup twice per org-scoped call.
    let orgMemberIds: string[] = []

    if (orgScoped && subscription) {
      const orgLimit = await getOrgUsageLimit(
        subscription.referenceId,
        subscription.plan,
        subscription.seats
      )
      limit = orgLimit.limit

      const pooled = await getPooledOrgCurrentPeriodCost(subscription.referenceId)
      orgMemberIds = pooled.memberIds
      currentUsage = pooled.currentPeriodCost
    } else {
      limit = stats.currentUsageLimit
        ? toNumber(toDecimal(stats.currentUsageLimit))
        : getFreeTierLimit()
    }

    const billingPeriodStart = subscription?.periodStart ?? null
    const billingPeriodEnd = subscription?.periodEnd ?? null

    let dailyRefreshConsumed = 0
    if (subscription && isPaid(subscription.plan) && billingPeriodStart) {
      const planDollars = getPlanTierDollars(subscription.plan)
      if (planDollars > 0) {
        if (orgScoped) {
          if (orgMemberIds.length > 0) {
            const userBounds = await getOrgMemberRefreshBounds(
              subscription.referenceId,
              billingPeriodStart
            )
            dailyRefreshConsumed = await computeDailyRefreshConsumed({
              userIds: orgMemberIds,
              periodStart: billingPeriodStart,
              periodEnd: billingPeriodEnd,
              planDollars,
              seats: subscription.seats || 1,
              userBounds: Object.keys(userBounds).length > 0 ? userBounds : undefined,
            })
          }
        } else {
          dailyRefreshConsumed = await computeDailyRefreshConsumed({
            userIds: [userId],
            periodStart: billingPeriodStart,
            periodEnd: billingPeriodEnd,
            planDollars,
          })
        }
      }
    }

    const effectiveUsage = Math.max(0, currentUsage - dailyRefreshConsumed)
    const percentUsed = limit > 0 ? Math.min((effectiveUsage / limit) * 100, 100) : 0
    const isWarning = percentUsed >= 80
    const isExceeded = effectiveUsage >= limit

    return {
      currentUsage: effectiveUsage,
      limit,
      percentUsed,
      isWarning,
      isExceeded,
      billingPeriodStart,
      billingPeriodEnd,
      lastPeriodCost: toNumber(toDecimal(stats.lastPeriodCost)),
    }
  } catch (error) {
    logger.error('Failed to get user usage data', { userId, error })
    throw error
  }
}

/**
 * Get usage limit information for a user
 */
export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  try {
    const [subscription, userStatsRecord] = await Promise.all([
      getHighestPrioritySubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    if (userStatsRecord.length === 0) {
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsRecord[0]
    const orgScoped = isOrgScopedSubscription(subscription, userId)

    let currentLimit: number
    let minimumLimit: number
    let canEdit: boolean

    if (orgScoped && subscription) {
      const orgLimit = await getOrgUsageLimit(
        subscription.referenceId,
        subscription.plan,
        subscription.seats
      )
      currentLimit = orgLimit.limit
      minimumLimit = orgLimit.minimum
      canEdit = false
    } else {
      currentLimit = stats.currentUsageLimit
        ? toNumber(toDecimal(stats.currentUsageLimit))
        : getFreeTierLimit()
      minimumLimit = getPerUserMinimumLimit(subscription)
      canEdit = canEditUsageLimit(subscription)
    }

    return {
      currentLimit,
      canEdit,
      minimumLimit,
      plan: subscription?.plan || 'free',
      updatedAt: stats.usageLimitUpdatedAt,
      scope: orgScoped ? 'organization' : 'user',
      organizationId: orgScoped && subscription ? subscription.referenceId : null,
    }
  } catch (error) {
    logger.error('Failed to get usage limit info', { userId, error })
    throw error
  }
}

/**
 * Initialize usage limits for a new user
 */
export async function initializeUserUsageLimit(userId: string): Promise<void> {
  // Check if user already has usage stats
  const existingStats = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (existingStats.length > 0) {
    return
  }

  const subscription = await getHighestPrioritySubscription(userId)
  const orgScoped = isOrgScopedSubscription(subscription, userId)

  await db.insert(userStats).values({
    id: generateId(),
    userId,
    currentUsageLimit: orgScoped ? null : getFreeTierLimit().toString(),
    usageLimitUpdatedAt: new Date(),
  })

  logger.info('Initialized user stats', {
    userId,
    plan: subscription?.plan || 'free',
    hasIndividualLimit: !orgScoped,
  })
}

/**
 * Update a user's custom usage limit
 */
export async function updateUserUsageLimit(
  userId: string,
  newLimit: number,
  setBy?: string // For team admin tracking
): Promise<{ success: boolean; error?: string }> {
  try {
    const subscription = await getHighestPrioritySubscription(userId)

    if (isOrgScopedSubscription(subscription, userId)) {
      return {
        success: false,
        error:
          'This subscription is managed at the organization level. Update the organization usage limit instead.',
      }
    }

    // Only pro users can edit limits (free users cannot)
    if (!subscription || isFree(subscription.plan)) {
      return { success: false, error: 'Free plan users cannot edit usage limits' }
    }

    const billingStatus = await getEffectiveBillingStatus(userId)
    if (!hasUsableSubscriptionAccess(subscription.status, billingStatus.billingBlocked)) {
      return { success: false, error: 'An active subscription is required to edit usage limits' }
    }

    const minimumLimit = getPerUserMinimumLimit(subscription)

    logger.info('Applying plan-based validation', {
      userId,
      newLimit,
      minimumLimit,
      plan: subscription?.plan,
    })

    // Validate new limit is not below minimum
    if (newLimit < minimumLimit) {
      return {
        success: false,
        error: `Usage limit cannot be below plan minimum of $${minimumLimit}`,
      }
    }

    await db
      .update(userStats)
      .set({
        currentUsageLimit: newLimit.toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Updated user usage limit', {
      userId,
      newLimit,
      setBy: setBy || userId,
      planMinimum: minimumLimit,
      plan: subscription?.plan,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update usage limit', { userId, newLimit, error })
    return { success: false, error: 'Failed to update usage limit' }
  }
}

/**
 * Get usage limit for a user (used by checkUsageStatus for server-side
 * checks). Org-scoped subs return the organization limit;
 * personally-scoped subs return the individual user limit from userStats.
 */
export async function getUserUsageLimit(
  userId: string,
  preloadedSubscription?: HighestPrioritySubscription
): Promise<number> {
  const subscription =
    preloadedSubscription !== undefined
      ? preloadedSubscription
      : await getHighestPrioritySubscription(userId)

  if (isOrgScopedSubscription(subscription, userId) && subscription) {
    const orgExists = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, subscription.referenceId))
      .limit(1)

    if (orgExists.length === 0) {
      throw new Error(`Organization not found: ${subscription.referenceId} for user: ${userId}`)
    }

    const orgLimit = await getOrgUsageLimit(
      subscription.referenceId,
      subscription.plan,
      subscription.seats
    )
    return orgLimit.limit
  }

  const userStatsQuery = await db
    .select({ currentUsageLimit: userStats.currentUsageLimit })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (userStatsQuery.length === 0) {
    throw new Error(
      `No user stats record found for userId: ${userId}. User must be properly initialized before execution.`
    )
  }

  if (!userStatsQuery[0].currentUsageLimit) {
    throw new Error(
      `Invalid null usage limit for ${subscription?.plan || 'free'} user: ${userId}. User stats must be properly initialized.`
    )
  }

  return toNumber(toDecimal(userStatsQuery[0].currentUsageLimit))
}

/**
 * Check usage status with warning thresholds
 */
export async function checkUsageStatus(userId: string): Promise<{
  status: 'ok' | 'warning' | 'exceeded'
  usageData: UsageData
}> {
  try {
    const usageData = await getUserUsageData(userId)

    let status: 'ok' | 'warning' | 'exceeded' = 'ok'
    if (usageData.isExceeded) {
      status = 'exceeded'
    } else if (usageData.isWarning) {
      status = 'warning'
    }

    return {
      status,
      usageData,
    }
  } catch (error) {
    logger.error('Failed to check usage status', { userId, error })
    throw error
  }
}

/**
 * Sync usage limits based on subscription changes
 */
export async function syncUsageLimitsFromSubscription(userId: string): Promise<void> {
  const [subscription, currentUserStats] = await Promise.all([
    getHighestPrioritySubscription(userId),
    db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
  ])

  if (currentUserStats.length === 0) {
    throw new Error(`User stats not found for userId: ${userId}`)
  }

  const currentStats = currentUserStats[0]

  if (isOrgScopedSubscription(subscription, userId)) {
    if (currentStats.currentUsageLimit !== null) {
      await db
        .update(userStats)
        .set({
          currentUsageLimit: null,
          usageLimitUpdatedAt: new Date(),
        })
        .where(eq(userStats.userId, userId))

      logger.info('Cleared individual limit for org-scoped member', {
        userId,
        plan: subscription?.plan,
      })
    }
    return
  }
  const defaultLimit = getPerUserMinimumLimit(subscription)
  const currentLimit = currentStats.currentUsageLimit
    ? toNumber(toDecimal(currentStats.currentUsageLimit))
    : 0

  if (!subscription || !hasPaidSubscriptionStatus(subscription.status)) {
    // Downgraded to free
    await db
      .update(userStats)
      .set({
        currentUsageLimit: getFreeTierLimit().toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Set limit to free tier', { userId })
  } else if (currentLimit < defaultLimit) {
    await db
      .update(userStats)
      .set({
        currentUsageLimit: defaultLimit.toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.info('Raised limit to plan minimum', {
      userId,
      newLimit: defaultLimit,
    })
  }
  // Keep higher custom limits unchanged
}

/**
 * Get usage limit information for team members (for admin dashboard)
 */
export async function getTeamUsageLimits(organizationId: string): Promise<
  Array<{
    userId: string
    userName: string
    userEmail: string
    currentLimit: number
    currentUsage: number
    totalCost: number
    lastActive: Date | null
  }>
> {
  try {
    const teamMembers = await db
      .select({
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
        currentLimit: userStats.currentUsageLimit,
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
        lastActive: userStats.lastActive,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(userStats, eq(member.userId, userStats.userId))
      .where(eq(member.organizationId, organizationId))

    return teamMembers.map((memberData) => ({
      userId: memberData.userId,
      userName: memberData.userName,
      userEmail: memberData.userEmail,
      currentLimit: toNumber(toDecimal(memberData.currentLimit || getFreeTierLimit().toString())),
      currentUsage: toNumber(toDecimal(memberData.currentPeriodCost)),
      totalCost: toNumber(toDecimal(memberData.totalCost)),
      lastActive: memberData.lastActive,
    }))
  } catch (error) {
    logger.error('Failed to get team usage limits', { organizationId, error })
    return []
  }
}

/**
 * Returns the effective current period usage cost for a user, with daily
 * refresh credits deducted. Org-scoped subs return the pooled sum across
 * all org members; personally-scoped subs return this user's own cost.
 */
export async function getEffectiveCurrentPeriodCost(userId: string): Promise<number> {
  const subscription = await getHighestPrioritySubscription(userId)
  const orgScoped = isOrgScopedSubscription(subscription, userId)

  let rawCost: number
  let refreshUserIds: string[] = [userId]

  if (orgScoped && subscription) {
    const pooled = await getPooledOrgCurrentPeriodCost(subscription.referenceId)
    if (pooled.memberIds.length === 0) return 0
    refreshUserIds = pooled.memberIds
    rawCost = pooled.currentPeriodCost
  } else {
    const rows = await db
      .select({ current: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (rows.length === 0) return 0
    rawCost = toNumber(toDecimal(rows[0].current))
  }

  if (!subscription || !isPaid(subscription.plan) || !subscription.periodStart) {
    return rawCost
  }

  const planDollars = getPlanTierDollars(subscription.plan)
  if (planDollars <= 0) return rawCost

  const userBounds =
    orgScoped && subscription.periodStart
      ? await getOrgMemberRefreshBounds(subscription.referenceId, subscription.periodStart)
      : {}

  const refreshConsumed = await computeDailyRefreshConsumed({
    userIds: refreshUserIds,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd ?? null,
    planDollars,
    seats: subscription.seats || 1,
    userBounds: Object.keys(userBounds).length > 0 ? userBounds : undefined,
  })

  return Math.max(0, rawCost - refreshConsumed)
}

/**
 * Calculate billing projection based on current usage
 */
export async function calculateBillingProjection(userId: string): Promise<BillingData> {
  try {
    const usageData = await getUserUsageData(userId)

    if (!usageData.billingPeriodStart || !usageData.billingPeriodEnd) {
      return {
        currentPeriodCost: usageData.currentUsage,
        projectedCost: usageData.currentUsage,
        limit: usageData.limit,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        daysRemaining: 0,
      }
    }

    const now = new Date()
    const periodStart = new Date(usageData.billingPeriodStart)
    const periodEnd = new Date(usageData.billingPeriodEnd)

    const totalDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    )
    const daysElapsed = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, totalDays - daysElapsed)

    // Project cost based on daily usage rate
    const dailyRate = daysElapsed > 0 ? usageData.currentUsage / daysElapsed : 0
    const projectedCost = dailyRate * totalDays

    return {
      currentPeriodCost: usageData.currentUsage,
      projectedCost: Math.min(projectedCost, usageData.limit), // Cap at limit
      limit: usageData.limit,
      billingPeriodStart: usageData.billingPeriodStart,
      billingPeriodEnd: usageData.billingPeriodEnd,
      daysRemaining,
    }
  } catch (error) {
    logger.error('Failed to calculate billing projection', { userId, error })
    throw error
  }
}

/**
 * Send usage threshold notification when crossing from <80% to ≥80%.
 * - Skips when billing is disabled.
 * - Respects user-level notifications toggle and unsubscribe preferences.
 * - For organization plans, emails owners/admins who have notifications enabled.
 */
export async function maybeSendUsageThresholdEmail(params: {
  scope: 'user' | 'organization'
  planName: string
  percentBefore: number
  percentAfter: number
  userId?: string
  userEmail?: string
  userName?: string
  organizationId?: string
  currentUsageAfter: number
  limit: number
}): Promise<void> {
  try {
    if (!isBillingEnabled) return
    if (params.limit <= 0 || params.currentUsageAfter <= 0) return

    const baseUrl = getBaseUrl()
    const isFreeUser = params.planName === 'Free'

    // Check for 80% threshold crossing — used for paid users (budget warning) and free users (upgrade nudge)
    const crosses80 = params.percentBefore < 80 && params.percentAfter >= 80
    // Check for 100% threshold (free users only — credits exhausted)
    const crosses100 = params.percentBefore < 100 && params.percentAfter >= 100

    // Skip if no thresholds crossed
    if (!crosses80 && !crosses100) return

    // For 80% threshold email (paid users only)
    if (crosses80 && !isFreeUser) {
      const ctaLink = `${baseUrl}/workspace?billing=usage`
      const sendTo = async (email: string, name?: string) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const html = await renderUsageThresholdEmail({
          userName: name,
          planName: params.planName,
          percentUsed: Math.min(100, Math.round(params.percentAfter)),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
          ctaLink,
        })

        await sendEmail({
          to: email,
          subject: getEmailSubject('usage-threshold'),
          html,
          emailType: 'notifications',
        })
      }

      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await sendTo(params.userEmail, params.userName)
      } else if (params.scope === 'organization' && params.organizationId) {
        const admins = await db
          .select({
            email: user.email,
            name: user.name,
            enabled: settings.billingUsageNotificationsEnabled,
            role: member.role,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(settings, eq(settings.userId, member.userId))
          .where(eq(member.organizationId, params.organizationId))

        for (const a of admins) {
          const isAdmin = a.role === 'owner' || a.role === 'admin'
          if (!isAdmin) continue
          if (a.enabled === false) continue
          if (!a.email) continue
          await sendTo(a.email, a.name || undefined)
        }
      }
    }

    // For 80% threshold email (free users only — skip if they also crossed 100% in same call)
    if (crosses80 && isFreeUser && !crosses100) {
      const upgradeLink = `${baseUrl}/workspace?billing=upgrade`
      const sendFreeTierEmail = async (email: string, name?: string) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const html = await renderFreeTierUpgradeEmail({
          userName: name,
          percentUsed: Math.min(100, Math.round(params.percentAfter)),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
          upgradeLink,
        })

        await sendEmail({
          to: email,
          subject: getEmailSubject('free-tier-upgrade'),
          html,
          emailType: 'notifications',
        })

        logger.info('Free tier upgrade email sent', {
          email,
          percentUsed: Math.round(params.percentAfter),
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
        })
      }

      // Free users are always individual scope (not organization)
      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await sendFreeTierEmail(params.userEmail, params.userName)
      }
    }

    // For 100% threshold email (free users only — credits exhausted)
    if (crosses100 && isFreeUser) {
      const upgradeLink = `${baseUrl}/workspace?billing=upgrade`
      const sendExhaustedEmail = async (email: string, name?: string) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const html = await renderCreditsExhaustedEmail({
          userName: name,
          limit: params.limit,
          upgradeLink,
        })

        await sendEmail({
          to: email,
          subject: getEmailSubject('free-tier-exhausted'),
          html,
          emailType: 'notifications',
        })

        logger.info('Free tier credits exhausted email sent', {
          email,
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
        })
      }

      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await sendExhaustedEmail(params.userEmail, params.userName)
      }
    }
  } catch (error) {
    logger.error('Failed to send usage threshold email', {
      scope: params.scope,
      userId: params.userId,
      organizationId: params.organizationId,
      error,
    })
  }
}
