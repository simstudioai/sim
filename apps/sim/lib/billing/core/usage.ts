import { db } from '@sim/db'
import { member, organization, settings, user, userStats, userStatsColumns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  getHighestPrioritySubscription,
  type HighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import {
  type ResolvedUsagePeriod,
  resolveSubscriptionUsagePeriod,
} from '@/lib/billing/core/reporting-period'
import { type BillingEntity, getBillingPeriodUsageCost } from '@/lib/billing/core/usage-log'
import { computeWeeklyRefreshConsumed } from '@/lib/billing/credits/weekly-refresh'
import {
  getPlanWeeklyRefreshDollars,
  isEnterprise,
  isFree,
  isPaid,
} from '@/lib/billing/plan-helpers'
import {
  canEditUsageLimit,
  getFreeTierLimit,
  getPerUserMinimumLimit,
  getPlanPricing,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import type { UsageData, UsageLimitInfo } from '@/lib/billing/types'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { Decimal, toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbClient } from '@/lib/db/types'
import { getEmailPreferences } from '@/lib/messaging/email/unsubscribe'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

const logger = createLogger('UsageManagement')

/**
 * Email rendering pulls the React templates and every mail provider into the
 * module graph, which is ~1.2s of imports on every route that reaches billing
 * attribution. Load it only when a threshold email is actually being sent.
 */
async function loadEmailDelivery() {
  const [emails, mailer] = await Promise.all([
    import('@/components/emails'),
    import('@/lib/messaging/email/mailer'),
  ])
  return { ...emails, sendEmail: mailer.sendEmail }
}

export interface OrgUsageLimitResult {
  limit: number
  minimum: number
}

export interface UsageLimitSubscription {
  referenceId: string
  plan: string
  status: string | null
  seats: number | null
  periodStart: Date | null
  periodEnd: Date | null
  billingInterval?: string | null
  metadata?: unknown
  usagePeriod?: ResolvedUsagePeriod | null
}

/**
 * Pooled previous-period bookkeeping total for an organization — the sum of
 * member `lastPeriodCost` rows, which the cycle-close sweep writes from
 * ledger sums. Current-period usage is never read here — it is always the
 * attributed usage_log ledger.
 *
 * Uses `LEFT JOIN` so members whose `userStats` row is missing still
 * count (contributing 0).
 */
export async function getOrgLastPeriodCost(
  organizationId: string,
  executor: DbClient = db
): Promise<number> {
  const rows = await executor
    .select({ lastPeriodCost: userStats.lastPeriodCost })
    .from(member)
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))

  let lastPeriodCost = new Decimal(0)
  for (const row of rows) {
    lastPeriodCost = lastPeriodCost.plus(toDecimal(row.lastPeriodCost))
  }
  return toNumber(lastPeriodCost)
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
  seats: number | null,
  executor: DbClient = db
): Promise<OrgUsageLimitResult> {
  const orgData = await executor
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
 * Always writes to the primary — never takes a read-routing executor.
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

export interface ResolvedUserUsageData {
  usage: UsageData
  subscription: HighestPrioritySubscription
  /** The personal balance from the same user-stats row used to calculate usage. */
  personalCreditBalance: number
}

/** Resolves comprehensive usage and the subscription that determined its billing scope. */
export async function getResolvedUserUsageData(
  userId: string,
  executor: DbClient = db
): Promise<ResolvedUserUsageData> {
  try {
    // Write — always on the primary regardless of executor routing.
    await ensureUserStatsExists(userId)

    const [userStatsData, subscription] = await Promise.all([
      // Read-your-write: must see the row ensureUserStatsExists may have just
      // inserted, which a lagging replica can miss (this path throws on a
      // missing row). Stays on the primary deliberately.
      db
        .select(userStatsColumns)
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),
      getHighestPrioritySubscription(userId, { executor }),
    ])

    if (userStatsData.length === 0) {
      logger.error('User stats not found for userId', { userId })
      throw new Error(`User stats not found for userId: ${userId}`)
    }

    const stats = userStatsData[0]
    const orgScoped = isOrgScopedSubscription(subscription, userId)
    const billingPeriod = resolveSubscriptionUsagePeriod(subscription) ?? {
      ...defaultBillingPeriod(),
      source: 'default' as const,
      anchorDate: null,
      interval: null,
    }

    let currentUsage = orgScoped
      ? 0
      : await getBillingPeriodUsageCost(
          { type: 'user', id: userId },
          billingPeriod,
          undefined,
          executor
        )
    let lastPeriodCost = toNumber(toDecimal(stats.lastPeriodCost))

    let limit: number

    if (orgScoped && subscription) {
      const orgLimit = await getOrgUsageLimit(
        subscription.referenceId,
        subscription.plan,
        subscription.seats,
        executor
      )
      limit = orgLimit.limit

      lastPeriodCost = await getOrgLastPeriodCost(subscription.referenceId, executor)
      currentUsage = await getBillingPeriodUsageCost(
        { type: 'organization', id: subscription.referenceId },
        billingPeriod,
        undefined,
        executor
      )
    } else {
      limit = stats.currentUsageLimit
        ? toNumber(toDecimal(stats.currentUsageLimit))
        : getFreeTierLimit()
    }

    const billingPeriodStart = billingPeriod.source === 'default' ? null : billingPeriod.start
    const billingPeriodEnd = billingPeriod.source === 'default' ? null : billingPeriod.end

    let weeklyRefreshConsumed = 0
    if (subscription && isPaid(subscription.plan) && billingPeriodStart) {
      const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(subscription.plan)
      if (weeklyRefreshDollars > 0) {
        weeklyRefreshConsumed = await computeWeeklyRefreshConsumed(
          {
            billingEntity: orgScoped
              ? { type: 'organization', id: subscription.referenceId }
              : { type: 'user', id: userId },
            periodStart: billingPeriodStart,
            periodEnd: billingPeriodEnd,
            weeklyRefreshDollars,
            seats: orgScoped ? subscription.seats || 1 : undefined,
          },
          executor
        )
      }
    }

    const effectiveUsage = Math.max(0, currentUsage - weeklyRefreshConsumed)
    const percentUsed = limit > 0 ? Math.min((effectiveUsage / limit) * 100, 100) : 0
    const isWarning = percentUsed >= 80
    const isExceeded = effectiveUsage >= limit

    return {
      usage: {
        currentUsage: effectiveUsage,
        limit,
        percentUsed,
        isWarning,
        isExceeded,
        billingPeriodStart,
        billingPeriodEnd,
        lastPeriodCost,
      },
      subscription,
      personalCreditBalance: toNumber(toDecimal(stats.creditBalance)),
    }
  } catch (error) {
    logger.error('Failed to get user usage data', { userId, error })
    throw error
  }
}

/** Get comprehensive usage data for a user. */
export async function getUserUsageData(
  userId: string,
  executor: DbClient = db
): Promise<UsageData> {
  return (await getResolvedUserUsageData(userId, executor)).usage
}

/**
 * Get usage limit information for a user
 */
export async function getUserUsageLimitInfo(userId: string): Promise<UsageLimitInfo> {
  try {
    const [subscription, userStatsRecord] = await Promise.all([
      getHighestPrioritySubscription(userId),
      db.select(userStatsColumns).from(userStats).where(eq(userStats.userId, userId)).limit(1),
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
 *
 * Org-scoped members carry a null `currentUsageLimit` by design (see
 * `syncUsageLimitsFromSubscription`). A user whose subscription stops being
 * org-scoped without a resync would otherwise stay null and fail closed on
 * every execution, so a null limit self-heals to the plan/free base plus the
 * exact prepaid balance here. The write-back is best-effort: a limit written
 * concurrently wins, and a failed write still resolves to the fallback
 * instead of blocking execution.
 */
export async function getUserUsageLimit(
  userId: string,
  preloadedSubscription?: UsageLimitSubscription | null
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
    .select({
      currentUsageLimit: userStats.currentUsageLimit,
      creditBalance: userStats.creditBalance,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (userStatsQuery.length === 0) {
    throw new Error(
      `No user stats record found for userId: ${userId}. User must be properly initialized before execution.`
    )
  }

  if (!userStatsQuery[0].currentUsageLimit) {
    const baseLimit =
      subscription && hasPaidSubscriptionStatus(subscription.status)
        ? getPerUserMinimumLimit(subscription)
        : getFreeTierLimit()
    const fallbackLimit = toDecimal(baseLimit).plus(toDecimal(userStatsQuery[0].creditBalance))

    try {
      const healed = await db
        .update(userStats)
        .set({
          currentUsageLimit: fallbackLimit.toString(),
          usageLimitUpdatedAt: new Date(),
        })
        .where(and(eq(userStats.userId, userId), isNull(userStats.currentUsageLimit)))
        .returning({ currentUsageLimit: userStats.currentUsageLimit })

      if (healed.length === 0) {
        const concurrent = await db
          .select({ currentUsageLimit: userStats.currentUsageLimit })
          .from(userStats)
          .where(eq(userStats.userId, userId))
          .limit(1)

        if (concurrent[0]?.currentUsageLimit) {
          return toNumber(toDecimal(concurrent[0].currentUsageLimit))
        }
      }

      logger.warn('Healed null usage limit to plan default', {
        userId,
        plan: subscription?.plan || 'free',
        fallbackLimit: toNumber(fallbackLimit),
      })
    } catch (error) {
      logger.error('Failed to heal null usage limit', {
        userId,
        fallbackLimit: toNumber(fallbackLimit),
        error,
      })
    }

    return toNumber(fallbackLimit)
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
    db.select(userStatsColumns).from(userStats).where(eq(userStats.userId, userId)).limit(1),
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
  const baseLimit = toDecimal(getPerUserMinimumLimit(subscription)).toString()
  const hasEntitledPersonalSubscription =
    subscription !== null && hasPaidSubscriptionStatus(subscription.status)
  const liveMinimum = sql`${baseLimit}::numeric + ${userStats.creditBalance}`
  await db
    .update(userStats)
    .set({
      currentUsageLimit: hasEntitledPersonalSubscription
        ? sql`greatest(coalesce(${userStats.currentUsageLimit}, 0), ${liveMinimum})`
        : liveMinimum,
      usageLimitUpdatedAt: new Date(),
    })
    .where(
      and(
        eq(userStats.userId, userId),
        hasEntitledPersonalSubscription
          ? sql`coalesce(${userStats.currentUsageLimit}, 0) < ${liveMinimum}`
          : sql`${userStats.currentUsageLimit} is distinct from ${liveMinimum}`
      )
    )

  logger.info(
    hasEntitledPersonalSubscription
      ? 'Synchronized plan-plus-prepaid minimum'
      : 'Reset limit to free-plus-prepaid minimum',
    { userId, baseLimit: Number(baseLimit) }
  )
  // Keep higher custom limits unchanged only while personal billing is entitled.
}

/**
 * Returns the effective current period usage cost for a user, with weekly
 * refresh credits deducted. Org-scoped subs return the pooled sum across
 * all org members; personally-scoped subs return this user's own cost.
 */
export async function getEffectiveCurrentPeriodCost(
  userId: string,
  executor: DbClient = db
): Promise<number> {
  const subscription = await getHighestPrioritySubscription(userId, { executor })
  const orgScoped = isOrgScopedSubscription(subscription, userId)

  const billingPeriod = resolveSubscriptionUsagePeriod(subscription) ?? {
    ...defaultBillingPeriod(),
    source: 'default' as const,
    anchorDate: null,
    interval: null,
  }

  const billingEntity: BillingEntity =
    orgScoped && subscription
      ? { type: 'organization', id: subscription.referenceId }
      : { type: 'user', id: userId }
  const rawCost = await getBillingPeriodUsageCost(billingEntity, billingPeriod, undefined, executor)

  if (!subscription || !isPaid(subscription.plan) || !subscription.periodStart) {
    return rawCost
  }

  const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(subscription.plan)
  if (weeklyRefreshDollars <= 0) return rawCost

  const refreshConsumed = await computeWeeklyRefreshConsumed(
    {
      billingEntity,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd ?? null,
      weeklyRefreshDollars,
      seats: subscription.seats || 1,
    },
    executor
  )

  return Math.max(0, rawCost - refreshConsumed)
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
  /** Workspace the usage occurred in, used to build a live upgrade/billing link. */
  workspaceId?: string
  currentUsageAfter: number
  limit: number
}): Promise<void> {
  try {
    if (!isBillingEnabled) return
    if (params.limit <= 0 || params.currentUsageAfter <= 0) return

    const baseUrl = getBaseUrl()
    const isFreeUser = params.planName === 'Free'

    const upgradeCreditsLink = params.workspaceId
      ? `${baseUrl}${buildUpgradeHref(params.workspaceId, 'credits')}`
      : `${baseUrl}${APP_ENTRY_PATH}`
    /**
     * Organization billing is reached through the workspace the usage occurred in
     * — that is the only plane that serves it. Without a workspace there is no such
     * link to build, so the account page is the honest fallback rather than a guess
     * at which workspace the recipient would want.
     */
    const billingSettingsLink =
      params.scope === 'organization' && params.workspaceId
        ? `${baseUrl}/workspace/${params.workspaceId}/settings/billing`
        : `${baseUrl}/account/settings/billing`

    // Check for 80% threshold crossing — used for paid users (budget warning) and free users (upgrade nudge)
    const crosses80 = params.percentBefore < 80 && params.percentAfter >= 80
    // Check for 100% threshold — every plan and scope (usage limit reached)
    const crosses100 = params.percentBefore < 100 && params.percentAfter >= 100

    // Skip if no thresholds crossed
    if (!crosses80 && !crosses100) return

    /**
     * Delivers to the account's notification recipients: the payer for personal
     * scope, every org admin/owner for organization scope. Honors the per-user
     * billing-notification toggle in both.
     */
    const deliverToScope = async (send: (email: string, name?: string) => Promise<void>) => {
      if (params.scope === 'user' && params.userId && params.userEmail) {
        const rows = await db
          .select({ enabled: settings.billingUsageNotificationsEnabled })
          .from(settings)
          .where(eq(settings.userId, params.userId))
          .limit(1)
        if (rows.length > 0 && rows[0].enabled === false) return
        await send(params.userEmail, params.userName)
        return
      }

      if (params.scope === 'organization' && params.organizationId) {
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
          if (!isOrgAdminRole(a.role)) continue
          if (a.enabled === false) continue
          if (!a.email) continue
          await send(a.email, a.name || undefined)
        }
      }
    }

    // !crosses100: one "reached" email, not a "nearing" and a "reached" in the same moment
    if (crosses80 && !isFreeUser && !crosses100) {
      const ctaLink = billingSettingsLink
      await deliverToScope(async (email, name) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const { renderUsageThresholdEmail, getEmailSubject, sendEmail } = await loadEmailDelivery()
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
      })
    }

    // For 80% threshold email (free users only — skip if they also crossed 100% in same call)
    if (crosses80 && isFreeUser && !crosses100) {
      const upgradeLink = upgradeCreditsLink
      await deliverToScope(async (email, name) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const { renderFreeTierUpgradeEmail, getEmailSubject, sendEmail } = await loadEmailDelivery()
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
      })
    }

    // Paid and org accounts get raise-your-limit copy — upgrading is not their remedy
    if (crosses100) {
      const useFreeCopy = isFreeUser && params.scope === 'user'

      await deliverToScope(async (email, name) => {
        const prefs = await getEmailPreferences(email)
        if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

        const {
          renderCreditsExhaustedEmail,
          renderUsageLimitReachedEmail,
          getEmailSubject,
          getLimitEmailSubject,
          sendEmail,
        } = await loadEmailDelivery()
        const html = useFreeCopy
          ? await renderCreditsExhaustedEmail({
              userName: name,
              limit: params.limit,
              upgradeLink: upgradeCreditsLink,
            })
          : await renderUsageLimitReachedEmail({
              userName: name,
              planName: params.planName,
              scope: params.scope,
              currentUsage: params.currentUsageAfter,
              limit: params.limit,
              ctaLink: billingSettingsLink,
            })

        await sendEmail({
          to: email,
          subject: useFreeCopy
            ? getEmailSubject('free-tier-exhausted')
            : getLimitEmailSubject('credits', 'reached'),
          html,
          emailType: 'notifications',
        })

        logger.info('Usage limit reached email sent', {
          email,
          scope: params.scope,
          planName: params.planName,
          currentUsage: params.currentUsageAfter,
          limit: params.limit,
        })
      })
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
