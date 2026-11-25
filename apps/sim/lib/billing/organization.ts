import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { rebaseUsageLimit } from '@/lib/billing/core/plan-switch'
import { getOrganizationIdForSubscriptionReference } from '@/lib/billing/core/subscription'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { assertNoCompetingEnterpriseIssuance } from '@/lib/billing/enterprise-outbox'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/identity-lock'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isEnterprise, isOrgPlan, isPaid } from '@/lib/billing/plan-helpers'
import { SubscriptionReferenceNotFoundError } from '@/lib/billing/subscriptions/errors'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getOrgIncludedUsageDollars,
  resolveBillingInterval,
  SETTLED_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal } from '@/lib/billing/utils/decimal'
import type { DbTransaction } from '@/lib/db/types'
import {
  attachOwnedWorkspacesToOrganization,
  attachOwnedWorkspacesToOrganizationTx,
} from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('BillingOrganization')

type SubscriptionData = {
  id: string
  plan: string
  referenceId: string
  status: string | null
  seats?: number | null
  billingInterval?: string | null
  metadata?: unknown
  periodStart?: Date | null
  allowancePeriodStart?: Date | null
  allowanceSeatMonths?: number | string | null
  /** Correlation copied from Stripe metadata by the generic webhook callback. */
  enterpriseOperationId?: string | null
}

/**
 * Check if a user already owns an organization
 */
async function getUserOwnedOrganization(userId: string): Promise<string | null> {
  const existingMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1)

  if (existingMemberships.length > 0) {
    const [existingOrg] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, existingMemberships[0].organizationId))
      .limit(1)

    return existingOrg?.id || null
  }

  return null
}

export async function createOrganizationForTeamPlan(
  userId: string,
  userName?: string,
  userEmail?: string,
  organizationSlug?: string
): Promise<string> {
  try {
    const existingOrgId = await getUserOwnedOrganization(userId)
    if (existingOrgId) {
      return existingOrgId
    }

    const organizationName = userName || `${userEmail || 'User'}'s Team`
    const slug =
      organizationSlug ||
      `${userId}-team-${Date.now()}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-|-$/g, '')

    const { organizationId: orgId } = await createOrganizationWithOwner({
      ownerUserId: userId,
      name: organizationName,
      slug,
      metadata: {
        createdForTeamPlan: true,
        originalUserId: userId,
      },
    })

    logger.info('Created organization for team/enterprise plan', {
      userId,
      organizationId: orgId,
      organizationName,
    })

    return orgId
  } catch (error) {
    logger.error('Failed to create organization for team/enterprise plan', {
      userId,
      error,
    })
    throw error
  }
}

export async function ensureOrganizationForTeamSubscription(
  subscription: SubscriptionData
): Promise<SubscriptionData> {
  if (!isOrgPlan(subscription.plan)) {
    return subscription
  }

  if (await isSubscriptionOrgScoped(subscription)) {
    await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, subscription.referenceId)
      await assertNoCompetingEnterpriseIssuance(
        tx,
        subscription.referenceId,
        subscription.enterpriseOperationId ?? null
      )
    })
    return subscription
  }

  /**
   * The subscription references a user. Team/Enterprise subscriptions must be
   * org-referenced, so fall through to the membership resolution below: it
   * transfers the row onto the org the user administers (with duplicate
   * checks under the org mutation lock) or creates a new organization. This
   * keeps re-homing deterministic in the webhook flow instead of depending on
   * a client-side transfer call after checkout.
   *
   * A reference that is neither an organization nor a user (an organization
   * deleted under a live subscription) has no one to re-home onto, so it
   * fails as a dangling reference instead of seeding an organization owned
   * by a nonexistent user.
   */
  const userId = subscription.referenceId
  const [userData] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!userData) {
    throw new SubscriptionReferenceNotFoundError(subscription.referenceId)
  }

  logger.info('Creating organization for team subscription', {
    subscriptionId: subscription.id,
    userId,
  })

  const existingMembership = await db
    .select({
      id: member.id,
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  if (existingMembership.length > 0) {
    const membership = existingMembership[0]
    if (isOrgAdminRole(membership.role)) {
      /**
       * Atomic duplicate-subscription check + referenceId transfer.
       *
       * Row-level locks (`FOR UPDATE`) on the subscription and target
       * organization rows prevent a TOCTOU race between the "org has no
       * paid subscription" check and the transfer write — which could
       * otherwise let two concurrent webhook deliveries or org-creation
       * flows both pass the check and attach two subscriptions to the
       * same organization.
       */
      await db.transaction(async (tx) => {
        await acquireOrganizationMutationLock(tx, membership.organizationId)
        await assertNoCompetingEnterpriseIssuance(
          tx,
          membership.organizationId,
          subscription.enterpriseOperationId ?? null
        )

        /**
         * Re-verify the pre-transaction membership read under the org
         * mutation lock: a concurrent removal or role change must not let a
         * stale admin membership authorize the transfer.
         */
        const [lockedMembership] = await tx
          .select({ organizationId: member.organizationId, role: member.role })
          .from(member)
          .where(
            and(eq(member.userId, userId), eq(member.organizationId, membership.organizationId))
          )
          .limit(1)
        if (!lockedMembership || !isOrgAdminRole(lockedMembership.role)) {
          throw new Error(
            `User ${userId} no longer administers organization ${membership.organizationId}`
          )
        }

        const [lockedSub] = await tx
          .select({
            id: subscriptionTable.id,
            referenceId: subscriptionTable.referenceId,
            plan: subscriptionTable.plan,
          })
          .from(subscriptionTable)
          .where(eq(subscriptionTable.id, subscription.id))
          .for('update')

        if (!lockedSub) {
          throw new Error(`Subscription ${subscription.id} not found during transfer`)
        }

        if (lockedSub.referenceId === membership.organizationId) {
          return
        }

        if (!isOrgPlan(lockedSub.plan)) {
          throw new Error(
            `Subscription ${subscription.id} is no longer a team/enterprise plan (${lockedSub.plan})`
          )
        }

        const [lockedOrg] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, membership.organizationId))
          .for('update')

        if (!lockedOrg) {
          throw new Error(`Organization ${membership.organizationId} not found during transfer`)
        }

        const [existingOrgSub] = await tx
          .select({ id: subscriptionTable.id })
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, membership.organizationId),
              inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)

        if (existingOrgSub) {
          logger.error('Organization already has an active subscription', {
            userId,
            organizationId: membership.organizationId,
            newSubscriptionId: subscription.id,
          })
          throw new Error('Organization already has an active subscription')
        }

        await tx
          .update(subscriptionTable)
          .set({ referenceId: membership.organizationId })
          .where(eq(subscriptionTable.id, subscription.id))
      })

      logger.info('User already owns/admins an org, using it', {
        userId,
        organizationId: membership.organizationId,
      })

      await attachOwnedWorkspacesToOrganization({
        ownerUserId: userId,
        organizationId: membership.organizationId,
        externalMemberPolicy: 'keep-external',
        includeArchived: true,
      })

      return { ...subscription, referenceId: membership.organizationId }
    }

    logger.error('User is member of org but not owner/admin - cannot create team subscription', {
      userId,
      existingOrgId: membership.organizationId,
      subscriptionId: subscription.id,
    })
    throw new Error('User is already member of another organization')
  }

  const orgId = await createOrganizationForTeamPlan(
    userId,
    userData.name || undefined,
    userData.email || undefined
  )

  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, orgId)
    await assertNoCompetingEnterpriseIssuance(tx, orgId, subscription.enterpriseOperationId ?? null)

    const [lockedSub] = await tx
      .select({ id: subscriptionTable.id, referenceId: subscriptionTable.referenceId })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.id, subscription.id))
      .for('update')
    if (!lockedSub) {
      throw new Error(`Subscription ${subscription.id} not found during transfer`)
    }
    if (lockedSub.referenceId === orgId) return

    const [lockedOrg] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgId))
      .for('update')
    if (!lockedOrg) {
      throw new Error(`Organization ${orgId} not found during transfer`)
    }

    const [existingOrgSub] = await tx
      .select({ id: subscriptionTable.id })
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, orgId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
          ne(subscriptionTable.id, subscription.id)
        )
      )
      .limit(1)
    if (existingOrgSub) {
      throw new Error('Organization already has an active subscription')
    }

    await tx
      .update(subscriptionTable)
      .set({ referenceId: orgId })
      .where(eq(subscriptionTable.id, subscription.id))
  })

  await attachOwnedWorkspacesToOrganization({
    ownerUserId: userId,
    organizationId: orgId,
    externalMemberPolicy: 'keep-external',
    includeArchived: true,
  })

  logger.info('Created organization and updated subscription referenceId', {
    subscriptionId: subscription.id,
    userId,
    organizationId: orgId,
  })

  return { ...subscription, referenceId: orgId }
}

/**
 * Transaction-enlisted counterpart used only by invitation acceptance.
 *
 * The regular webhook helper above predates invitation-wide transactions and
 * performs several independent commits. Calling it while acceptance holds a
 * transaction would both trip the global-pool guard and allow a Pro→Team
 * conversion, new organization, workspace attachment, or outbox row to
 * survive an invitation rollback. This variant performs the same ownership
 * resolution and workspace attachment through the caller's transaction.
 */
export async function ensureOrganizationForTeamSubscriptionTx(
  tx: DbTransaction,
  subscription: SubscriptionData & { workspaceIdsToAttach: string[] }
): Promise<SubscriptionData & { usageLimitUserIds: string[] }> {
  if (!isOrgPlan(subscription.plan)) {
    return { ...subscription, usageLimitUserIds: [] }
  }

  const [referencedOrganization] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, subscription.referenceId))
    .limit(1)
  if (referencedOrganization) {
    await acquireOrganizationMutationLock(tx, referencedOrganization.id)
    await assertNoCompetingEnterpriseIssuance(
      tx,
      referencedOrganization.id,
      subscription.enterpriseOperationId ?? null
    )
    return {
      ...subscription,
      referenceId: referencedOrganization.id,
      usageLimitUserIds: [],
    }
  }

  const userId = subscription.referenceId
  const [existingMembership] = await tx
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  let organizationId: string
  if (existingMembership) {
    if (!isOrgAdminRole(existingMembership.role)) {
      throw new Error('User is already member of another organization')
    }
    organizationId = existingMembership.organizationId
    await acquireOrganizationMutationLock(tx, organizationId)
    await acquireUserBillingIdentityLock(tx, userId)
    await assertNoCompetingEnterpriseIssuance(
      tx,
      organizationId,
      subscription.enterpriseOperationId ?? null
    )

    const [lockedSubscription] = await tx
      .select({ id: subscriptionTable.id, referenceId: subscriptionTable.referenceId })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.id, subscription.id))
      .for('update')
    if (!lockedSubscription) {
      throw new Error(`Subscription ${subscription.id} not found during transfer`)
    }

    const [lockedOrganization] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
    if (!lockedOrganization) {
      throw new Error(`Organization ${organizationId} not found during transfer`)
    }

    const [existingOrganizationSubscription] = await tx
      .select({ id: subscriptionTable.id })
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
          ne(subscriptionTable.id, subscription.id)
        )
      )
      .limit(1)
    if (existingOrganizationSubscription) {
      throw new Error('Organization already has an active subscription')
    }
  } else {
    await acquireUserBillingIdentityLock(tx, userId)
    const [userData] = await tx
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!userData) {
      throw new Error(`User ${userId} not found while creating Team organization`)
    }

    organizationId = `org_${generateId()}`
    const now = new Date()
    await tx.insert(organization).values({
      id: organizationId,
      name: userData.name || `${userData.email || 'User'}'s Team`,
      slug: `${userId}-team-${generateId()}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-|-$/g, ''),
      metadata: { createdForTeamPlan: true, originalUserId: userId },
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(member).values({
      id: generateId(),
      userId,
      organizationId,
      role: 'owner',
      createdAt: now,
    })
    await acquireOrganizationMutationLock(tx, organizationId)
    await assertNoCompetingEnterpriseIssuance(
      tx,
      organizationId,
      subscription.enterpriseOperationId ?? null
    )
  }

  await tx
    .update(subscriptionTable)
    .set({ referenceId: organizationId })
    .where(eq(subscriptionTable.id, subscription.id))

  const attached = await attachOwnedWorkspacesToOrganizationTx(tx, {
    ownerUserId: userId,
    organizationId,
    workspaceIds: subscription.workspaceIdsToAttach,
    includeArchived: true,
  })

  return {
    ...subscription,
    referenceId: organizationId,
    usageLimitUserIds: attached.usageLimitUserIds,
  }
}

/**
 * Syncs the billing pool directly referenced by the subscription.
 * Organization membership does not select or reset a personal billing pool.
 */
export async function syncSubscriptionUsageLimits(subscription: SubscriptionData) {
  try {
    logger.info('Syncing subscription usage limits', {
      subscriptionId: subscription.id,
      referenceId: subscription.referenceId,
      plan: subscription.plan,
    })

    const organizationId = await getOrganizationIdForSubscriptionReference(subscription.referenceId)

    if (!organizationId) {
      const users = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, subscription.referenceId))
        .limit(1)

      if (users.length === 0) {
        throw new SubscriptionReferenceNotFoundError(subscription.referenceId)
      }

      await syncUsageLimitsFromSubscription(subscription.referenceId)

      logger.info('Synced usage limits for individual user subscription', {
        userId: subscription.referenceId,
        subscriptionId: subscription.id,
        plan: subscription.plan,
      })
    } else {
      /** Enterprise has custom pricing; other paid pools retain prepaid headroom when seats increase. */
      if (isPaid(subscription.plan) && !isEnterprise(subscription.plan)) {
        const current = await reconcileAnnualSeatMonths(subscription.id, organizationId)
        const priced = current ?? subscription
        const seats = priced.seats || 1
        const planBase = toDecimal(getOrgIncludedUsageDollars(priced)).toString()
        const liveMinimum = sql`${planBase}::numeric + ${organization.creditBalance}`

        await db
          .update(organization)
          .set({
            orgUsageLimit: sql`greatest(coalesce(${organization.orgUsageLimit}, 0), ${liveMinimum})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(organization.id, organizationId),
              sql`coalesce(${organization.orgUsageLimit}, 0) < ${liveMinimum}`
            )
          )

        logger.info('Synchronized organization plan-plus-prepaid minimum', {
          organizationId,
          plan: subscription.plan,
          seats,
          planBase,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to sync subscription usage limits', {
      subscriptionId: subscription.id,
      referenceId: subscription.referenceId,
      error,
    })
    throw error
  }
}

/** Annual subscriptions read per page of the hourly sweep. */
const ANNUAL_SWEEP_PAGE_SIZE = 200

const AVERAGE_MONTH_MS = 30.44 * 24 * 60 * 60 * 1000

/** Months left in a period at `now`, as a fraction: what Stripe prorates a seat change against. */
function monthsRemaining(periodEnd: Date | null, now: Date): number {
  if (!periodEnd) return 12
  return Math.min(12, Math.max(0, (periodEnd.getTime() - now.getTime()) / AVERAGE_MONTH_MS))
}

/**
 * The hourly upkeep of annual Pro and Team plans: an annual period includes twelve months of
 * credits, and the stored usage limit must reflect it.
 *
 * For a Team plan it first keeps the period's seat-months in step with the seat count: a new
 * period starts at `seats × 12`, and a seat added or removed since the last run adds or removes
 * only the months left, as Stripe prorates the charge. It then re-applies the limit floor, which
 * only ever raises a limit. Pages through every settled annual subscription. Returns how many it
 * synced.
 */
export async function syncAnnualPlanUsageLimits(): Promise<number> {
  let synced = 0
  let cursor = ''
  for (;;) {
    const page = await db
      .select()
      .from(subscriptionTable)
      .where(
        and(
          inArray(subscriptionTable.status, SETTLED_SUBSCRIPTION_STATUSES),
          ne(subscriptionTable.plan, 'enterprise'),
          ne(subscriptionTable.plan, 'free'),
          sql`coalesce(${subscriptionTable.billingInterval}, ${subscriptionTable.metadata}::jsonb->>'billingInterval') = 'year'`,
          sql`${subscriptionTable.id} > ${cursor}`
        )
      )
      .orderBy(subscriptionTable.id)
      .limit(ANNUAL_SWEEP_PAGE_SIZE)
    if (page.length === 0) return synced
    cursor = page[page.length - 1].id

    for (const listed of page) {
      try {
        // Re-read the row: a plan switch since the page was read must not be raised back.
        const [annual] = await db
          .select()
          .from(subscriptionTable)
          .where(eq(subscriptionTable.id, listed.id))
          .limit(1)
        if (
          !annual ||
          resolveBillingInterval(annual) !== 'year' ||
          !isPaid(annual.plan) ||
          !(SETTLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(annual.status ?? '')
        ) {
          continue
        }
        if (annual.billingInterval !== 'year') {
          // Older checkouts kept the interval only in metadata; readers of the column alone (the
          // billing attribution snapshot) then priced the plan as monthly.
          await db
            .update(subscriptionTable)
            .set({ billingInterval: 'year' })
            .where(eq(subscriptionTable.id, annual.id))
        }
        await syncSubscriptionUsageLimits({ ...annual, billingInterval: 'year' })
        synced++
      } catch (error) {
        logger.error('Failed to sync an annual plan usage limit', {
          subscriptionId: listed.id,
          error,
        })
      }
    }
  }
}

/**
 * Brings an annual Team subscription's seat-months up to date with its seat count, and moves the
 * organization's limit with the allowance. A new period starts at `seats × 12`; a seat added or
 * removed since the last count adds or removes only the months left, as Stripe prorates the charge.
 * The closing year's count is kept until its cycle close has priced it. Returns the current row, or
 * null when the subscription is not an annual Team plan.
 */
async function reconcileAnnualSeatMonths(
  subscriptionId: string,
  organizationId: string,
  now: Date = new Date()
): Promise<typeof subscriptionTable.$inferSelect | null> {
  const [annual] = await db
    .select()
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)
  if (
    !annual?.periodStart ||
    !isOrgPlan(annual.plan) ||
    isEnterprise(annual.plan) ||
    resolveBillingInterval(annual) !== 'year'
  ) {
    return annual ?? null
  }

  const seats = annual.seats || 1
  const samePeriod = annual.allowancePeriodStart?.getTime() === annual.periodStart.getTime()
  if (samePeriod && annual.allowanceSeats === seats && annual.allowanceSeatMonths !== null) {
    return annual
  }
  const previousYearOpen =
    !samePeriod &&
    annual.allowancePeriodStart !== null &&
    (annual.lastClosedPeriodStart === null ||
      annual.lastClosedPeriodStart.getTime() < annual.periodStart.getTime())
  if (previousYearOpen) return annual

  const allowanceSeatMonths =
    samePeriod && annual.allowanceSeats !== null && annual.allowanceSeatMonths !== null
      ? Math.max(
          0,
          Number(annual.allowanceSeatMonths) +
            (seats - annual.allowanceSeats) * monthsRemaining(annual.periodEnd, now)
        )
      : seats * 12
  const next = {
    ...annual,
    allowancePeriodStart: annual.periodStart,
    allowanceSeats: seats,
    allowanceSeatMonths: allowanceSeatMonths.toFixed(4),
  }
  const previousIncluded = getOrgIncludedUsageDollars(annual)
  const nextIncluded = getOrgIncludedUsageDollars(next)

  // One transaction: a limit left unrebased after the count advanced would never be retried.
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptionTable)
      .set({
        allowancePeriodStart: next.allowancePeriodStart,
        allowanceSeats: next.allowanceSeats,
        allowanceSeatMonths: next.allowanceSeatMonths,
      })
      .where(eq(subscriptionTable.id, annual.id))
    if (previousIncluded !== nextIncluded) {
      await rebaseUsageLimit(
        { pool: { type: 'organization', id: organizationId }, previousIncluded, nextIncluded },
        tx
      )
    }
  })
  return next
}
