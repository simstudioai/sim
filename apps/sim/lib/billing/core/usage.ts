import { db } from '@sim/db'
import { member, organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import {
  type CreditsThresholdClaim,
  claimCreditsThreshold,
  isCreditsThresholdUnclaimed,
  resolveLimitEmailRecipients,
} from '@/lib/billing/core/limit-notifications'
import {
  getHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription,
  type HighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import {
  type ResolvedUsagePeriod,
  resolveSubscriptionUsagePeriod,
} from '@/lib/billing/core/reporting-period'
import { readSoftGateUsageCost } from '@/lib/billing/core/reporting-usage-cache'
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
  getFreeTierAllowance,
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
import type { DbClient, DbOrTx } from '@/lib/db/types'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import {
  isDeletedAccountIdentity,
  userHasDeletedAccountIdentity,
} from '@/lib/users/deleted-identity'

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
  return (
    (await findOrgUsageLimit(organizationId, plan, seats, executor)) ??
    calculateOrgUsageLimit(organizationId, plan, seats, null)
  )
}

async function findOrgUsageLimit(
  organizationId: string,
  plan: string,
  seats: number | null,
  executor: DbClient = db
): Promise<OrgUsageLimitResult | null> {
  const [orgData] = await executor
    .select({ orgUsageLimit: organization.orgUsageLimit })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  if (!orgData) return null

  return calculateOrgUsageLimit(
    organizationId,
    plan,
    seats,
    orgData.orgUsageLimit ? toNumber(toDecimal(orgData.orgUsageLimit)) : null
  )
}

function calculateOrgUsageLimit(
  organizationId: string,
  plan: string,
  seats: number | null,
  configured: number | null
): OrgUsageLimitResult {
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
 * Users created in an auth request, keyed by Better Auth's endpoint context.
 * `user.create.after` and `account.create.after` of one signup receive the same
 * context object, which is how {@link handleNewSignInAccount} and
 * {@link ensureUserStatsExists} tell a signup's first sign-in apart from a
 * sign-in linked to an existing user later.
 */
const usersCreatedInAuthRequest = new WeakMap<object, string>()

function isUserCreatedInAuthRequest(
  userId: string,
  authRequest: object | null | undefined
): boolean {
  return authRequest ? usersCreatedInAuthRequest.get(authRequest) === userId : false
}

/**
 * Handle new user setup when they join the platform.
 * Creates the userStats record with the free allowance, which is zero when the
 * user's email or an already-linked social sign-in belongs to an account
 * deleted within the retention window. Every user Better Auth creates comes
 * through here, including SCIM- and SSO-provisioned users, so their email is
 * always checked at creation.
 *
 * @param authRequest Better Auth's endpoint context for the signup request, when there is one
 */
export async function handleNewUser(userId: string, authRequest?: object | null): Promise<void> {
  if (authRequest) usersCreatedInAuthRequest.set(authRequest, userId)
  try {
    const freeTierEligible = !(await userHasDeletedAccountIdentity(userId, {
      includeSignIns: true,
    }))
    if (!freeTierEligible) {
      logger.info('Withholding the free allowance from a returning deleted-account identity', {
        userId,
      })
    }
    await db.insert(userStats).values({
      id: generateId(),
      userId: userId,
      currentUsageLimit: getFreeTierAllowance(freeTierEligible).toString(),
      freeTierEligible,
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
 * The account-creation half of the signup check, for a social sign-in that was
 * not yet linked when {@link handleNewUser} ran. Only an account created in the
 * same auth request as its user is a signup. A sign-in linked to an existing
 * user in a later request never withholds anything; that includes a SCIM- or
 * SSO-provisioned user, whose email was already checked when it was created.
 * Only GitHub and Microsoft subjects are matched (see `lib/users/deleted-identity`);
 * a Google sign-in is matched by its email, and integration connections never are.
 *
 * @param authRequest Better Auth's endpoint context for the request creating the account
 */
export async function handleNewSignInAccount(
  {
    userId,
    providerId,
    accountId,
  }: {
    userId: string
    providerId: string
    accountId: string
  },
  authRequest: object | null | undefined
): Promise<void> {
  if (!isUserCreatedInAuthRequest(userId, authRequest)) return
  if (!(await isDeletedAccountIdentity({ oauthSubjects: [{ providerId, accountId }] }))) return
  await forfeitFreeTierAllowance(db, userId)
}

/**
 * Ensures a userStats record exists for a user.
 * Creates one with default values if missing.
 * This is a fallback for cases where the user.create.after hook didn't fire
 * or failed (e.g., OAuth account linking to existing users). A row created
 * here gets only the check signup would have made: the email always, and the
 * linked sign-ins only when the user was created in `authRequest`, so a sign-in
 * linked later never withholds. A failed check leaves the allowance in place
 * and never fails the caller.
 *
 * Always writes to the primary — never takes a read-routing executor.
 *
 * @param authRequest Better Auth's endpoint context, when called from an auth hook
 */
export async function ensureUserStatsExists(
  userId: string,
  authRequest?: object | null
): Promise<void> {
  await createUserStatsIfMissing(db, userId, {
    includeSignIns: isUserCreatedInAuthRequest(userId, authRequest),
  })
}

/**
 * Creates a user's `user_stats` row with the free allowance when none exists, on `executor`
 * (the caller's transaction, or `db`). Only a row this call creates gets the deleted-identity
 * check signup makes: the email always, and the linked sign-ins only when `includeSignIns` is
 * set. An existing row costs only the conflicting insert. A failed check leaves the allowance in
 * place and never fails the caller or aborts its transaction.
 *
 * @returns whether this call created the row
 */
export async function createUserStatsIfMissing(
  executor: DbOrTx,
  userId: string,
  { includeSignIns = false }: { includeSignIns?: boolean } = {}
): Promise<boolean> {
  const created = await executor
    .insert(userStats)
    .values({
      id: generateId(),
      userId,
      currentUsageLimit: getFreeTierLimit().toString(),
      usageLimitUpdatedAt: new Date(),
    })
    .onConflictDoNothing({ target: userStats.userId })
    .returning({ id: userStats.id })
  if (created.length === 0) return false

  try {
    if (await userHasDeletedAccountIdentity(userId, { includeSignIns }, executor)) {
      await forfeitFreeTierAllowance(executor, userId)
    }
  } catch (error) {
    logger.error('Failed to withhold the free allowance from a new stats row', { userId, error })
  }
  return true
}

interface ResolvedUserUsageData {
  usage: UsageData
  subscription: HighestPrioritySubscription
  /** The personal balance from the same user-stats row used to calculate usage. */
  personalCreditBalance: number
}

/** Resolves comprehensive usage and the subscription that determined its billing scope. */
async function getResolvedUserUsageData(
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
        .select()
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
        : getFreeTierAllowance(stats.freeTierEligible)
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
        : getFreeTierAllowance(stats.freeTierEligible)
      minimumLimit = getPerUserMinimumLimit(subscription, stats.freeTierEligible)
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

    // Reached only with a usable paid personal plan, whose floor never depends on the free allowance.
    const minimumLimit = getPerUserMinimumLimit(subscription, true)

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
 * Legacy organization membership syncs may have cleared the personal limit.
 * A null limit self-heals to the personal plan/free base plus the exact prepaid
 * balance here. The write-back is best-effort: a limit written concurrently
 * wins, and a failed write still resolves to the fallback instead of blocking
 * execution.
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
    const orgLimit = await findOrgUsageLimit(
      subscription.referenceId,
      subscription.plan,
      subscription.seats
    )

    if (!orgLimit) {
      throw new Error(`Organization not found: ${subscription.referenceId} for user: ${userId}`)
    }

    return orgLimit.limit
  }

  const userStatsQuery = await db
    .select({
      currentUsageLimit: userStats.currentUsageLimit,
      creditBalance: userStats.creditBalance,
      freeTierEligible: userStats.freeTierEligible,
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
        ? getPerUserMinimumLimit(subscription, userStatsQuery[0].freeTierEligible)
        : getFreeTierAllowance(userStatsQuery[0].freeTierEligible)
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
 * Withholds the free allowance from a new account found to reuse the sign-in
 * identity of a recently deleted one after its stats row was created. The flag
 * and the limit it implies commit together (a transaction on `db`, a savepoint
 * inside a caller's transaction), so a failed re-derivation can never leave the
 * account flagged but still holding the free limit; repeating the call is harmless.
 */
async function forfeitFreeTierAllowance(executor: DbOrTx, userId: string): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx.update(userStats).set({ freeTierEligible: false }).where(eq(userStats.userId, userId))
    await syncUsageLimitsFromSubscription(userId, tx)
  })
  logger.info('Withheld the free allowance from a returning deleted-account identity', { userId })
}

/**
 * Syncs the user's personal billing pool from their exact personal subscription.
 * Organization subscriptions have a separate pool and never clear personal limits.
 */
export async function syncUsageLimitsFromSubscription(
  userId: string,
  executor: DbOrTx = db
): Promise<void> {
  const [subscription, currentUserStats] = await Promise.all([
    getHighestPriorityPersonalSubscription(userId, { onError: 'throw', executor }),
    executor.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
  ])

  if (currentUserStats.length === 0) {
    throw new Error(`User stats not found for userId: ${userId}`)
  }

  const baseLimit = toDecimal(
    getPerUserMinimumLimit(subscription, currentUserStats[0].freeTierEligible)
  ).toString()
  const hasEntitledPersonalSubscription =
    subscription !== null && hasPaidSubscriptionStatus(subscription.status)
  const liveMinimum = sql`${baseLimit}::numeric + ${userStats.creditBalance}`
  await executor
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
}

/**
 * Returns the effective current period usage cost for a user, with weekly
 * refresh credits deducted. Org-scoped subs return the pooled sum across
 * all org members; personally-scoped subs return this user's own cost.
 *
 * Reported alongside every v1 API response, so an enterprise reporting window
 * on the default pool is served through {@link readSoftGateUsageCost}.
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
  const rawCost = await readSoftGateUsageCost(billingEntity, billingPeriod, executor)

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
 * Send the usage threshold notification for the level usage is at: the 80% warning or the 100%
 * limit-reached email, each at most once per billing period and limit.
 * - Level-triggered: any caller at or above a threshold may send it, so it tolerates a usage read
 *   that lags the ledger, and the claim ({@link claimCreditsThreshold}) is what keeps repeated or
 *   concurrent callers to one email. A new period or a changed limit re-arms both thresholds.
 * - Skips when billing is disabled.
 * - Returns after one indexed read once the threshold is claimed, so the completions that follow
 *   in the period cost no recipient lookup or write.
 * - Respects user-level notifications toggle and unsubscribe preferences, resolved before the
 *   claim so an account with nobody to notify never consumes it.
 * - For organization plans, emails owners/admins who have notifications enabled.
 */
export async function maybeSendUsageThresholdEmail(params: {
  scope: 'user' | 'organization'
  planName: string
  /** Start of the billing period the usage belongs to. */
  periodStart: Date
  userId?: string
  userEmail?: string
  userName?: string
  organizationId?: string
  /** Workspace the usage occurred in, used to build a live upgrade/billing link. */
  workspaceId?: string
  /** Usage before this completion was recorded. */
  usageBefore: number
  /** Cost this completion recorded; one that recorded nothing cannot move usage. */
  costDelta: number
  limit: number
}): Promise<void> {
  try {
    if (!isBillingEnabled) return
    if (params.limit <= 0 || params.costDelta <= 0) return

    const currentUsage = params.usageBefore + params.costDelta
    const percentUsed = (currentUsage / params.limit) * 100
    const threshold = percentUsed >= 100 ? 100 : percentUsed >= 80 ? 80 : undefined
    if (threshold === undefined) return
    const stateId = params.scope === 'user' ? params.userId : params.organizationId
    if (!stateId) return
    const claim: CreditsThresholdClaim = {
      scope: params.scope,
      id: stateId,
      periodStart: params.periodStart,
      limit: params.limit,
      threshold,
    }
    if (!(await isCreditsThresholdUnclaimed(claim))) return
    const recipients = await resolveLimitEmailRecipients(params.scope, params)
    if (recipients.length === 0) return
    if (!(await claimCreditsThreshold(claim))) return

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

    if (threshold === 80 && !isFreeUser) {
      const ctaLink = billingSettingsLink
      for (const { email, name } of recipients) {
        const { renderUsageThresholdEmail, getEmailSubject, sendEmail } = await loadEmailDelivery()
        const html = await renderUsageThresholdEmail({
          userName: name,
          planName: params.planName,
          percentUsed: Math.round(percentUsed),
          currentUsage,
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
    }

    if (threshold === 80 && isFreeUser) {
      const upgradeLink = upgradeCreditsLink
      for (const { email, name } of recipients) {
        const { renderFreeTierUpgradeEmail, getEmailSubject, sendEmail } = await loadEmailDelivery()
        const html = await renderFreeTierUpgradeEmail({
          userName: name,
          percentUsed: Math.round(percentUsed),
          currentUsage,
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
          percentUsed: Math.round(percentUsed),
          currentUsage,
          limit: params.limit,
        })
      }
    }

    if (threshold === 100) {
      const useFreeCopy = isFreeUser && params.scope === 'user'

      for (const { email, name } of recipients) {
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
              currentUsage,
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
          currentUsage,
          limit: params.limit,
        })
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
