import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { getPlanPricing, isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { getOrganizationIdForSubscriptionReference } from '@/lib/billing/core/subscription'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { assertNoCompetingEnterpriseIssuance } from '@/lib/billing/enterprise-outbox'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isEnterprise, isOrgPlan, isPaid } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal } from '@/lib/billing/utils/decimal'
import type { DbOrTx } from '@/lib/db/types'
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
   */
  const userId = subscription.referenceId

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

        const [lockedSub] = await tx
          .select({
            id: subscriptionTable.id,
            referenceId: subscriptionTable.referenceId,
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

  const [userData] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const orgId = await createOrganizationForTeamPlan(
    userId,
    userData?.name || undefined,
    userData?.email || undefined
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
  tx: DbOrTx,
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
  })

  return {
    ...subscription,
    referenceId: organizationId,
    usageLimitUserIds: attached.usageLimitUserIds,
  }
}

/**
 * Sync usage limits for subscription members
 * Updates usage limits for all users associated with the subscription
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
        throw new Error(
          `Subscription reference ${subscription.referenceId} does not match a user or organization`
        )
      }

      // Individual user subscription - sync their usage limits
      await syncUsageLimitsFromSubscription(subscription.referenceId)

      logger.info('Synced usage limits for individual user subscription', {
        userId: subscription.referenceId,
        subscriptionId: subscription.id,
        plan: subscription.plan,
      })
    } else {
      // Organization subscription - set org usage limit and sync member limits
      // Set orgUsageLimit for any paid non-enterprise plan attached to
      // the org. Enterprise is set via webhook with custom pricing.
      // Min = (basePrice × seats) + prepaid balance. Prepaid credits are
      // additive headroom and must not be absorbed by a later seat increase.
      if (isPaid(subscription.plan) && !isEnterprise(subscription.plan)) {
        const { basePrice } = getPlanPricing(subscription.plan)
        const seats = subscription.seats || 1
        const planBase = toDecimal(basePrice).times(seats).toString()
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
          basePrice,
        })
      }

      // Sync usage limits for all members
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      if (members.length > 0) {
        for (const m of members) {
          try {
            await syncUsageLimitsFromSubscription(m.userId)
          } catch (memberError) {
            logger.error('Failed to sync usage limits for organization member', {
              userId: m.userId,
              organizationId,
              subscriptionId: subscription.id,
              error: memberError,
            })
          }
        }

        logger.info('Synced usage limits for organization members', {
          organizationId,
          memberCount: members.length,
          subscriptionId: subscription.id,
          plan: subscription.plan,
        })

        /**
         * Storage is workspace-routed, not membership-routed. Workspace payer
         * changes transfer the workspace's own durable byte ledger atomically;
         * subscription sync must not move an account-wide user counter.
         */
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
