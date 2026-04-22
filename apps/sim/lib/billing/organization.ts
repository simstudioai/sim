import { db } from '@sim/db'
import {
  member,
  organization,
  subscription as subscriptionTable,
  user,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { getOrganizationIdForSubscriptionReference } from '@/lib/billing/core/subscription'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { isEnterprise, isOrgPlan, isPaid } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { attachOwnedWorkspacesToOrganization } from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('BillingOrganization')

type SubscriptionData = {
  id: string
  plan: string
  referenceId: string
  status: string | null
  seats?: number | null
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

  const referencedOrganizationId = await getOrganizationIdForSubscriptionReference(
    subscription.referenceId
  )

  if (referencedOrganizationId) {
    return {
      ...subscription,
      referenceId: referencedOrganizationId,
    }
  }

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
    if (membership.role === 'owner' || membership.role === 'admin') {
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

  await db
    .update(subscriptionTable)
    .set({ referenceId: orgId })
    .where(eq(subscriptionTable.id, subscription.id))

  await attachOwnedWorkspacesToOrganization({
    ownerUserId: userId,
    organizationId: orgId,
  })

  logger.info('Created organization and updated subscription referenceId', {
    subscriptionId: subscription.id,
    userId,
    organizationId: orgId,
  })

  return { ...subscription, referenceId: orgId }
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
      // Min = basePrice × seats, mirroring Stripe's `price × quantity`.
      if (isPaid(subscription.plan) && !isEnterprise(subscription.plan)) {
        const { basePrice } = getPlanPricing(subscription.plan)
        const seats = subscription.seats || 1
        const orgLimit = seats * basePrice

        // Only set if not already set or if updating to a higher value based on seats
        const orgData = await db
          .select({ orgUsageLimit: organization.orgUsageLimit })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1)

        const currentLimit =
          orgData.length > 0 && orgData[0].orgUsageLimit
            ? toNumber(toDecimal(orgData[0].orgUsageLimit))
            : 0

        // Update if no limit set, or if new seat-based minimum is higher
        if (currentLimit < orgLimit) {
          await db
            .update(organization)
            .set({
              orgUsageLimit: orgLimit.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(organization.id, organizationId))

          logger.info('Set organization usage limit', {
            organizationId,
            plan: subscription.plan,
            seats,
            basePrice,
            orgLimit,
            previousLimit: currentLimit,
          })
        }
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

        // Bulk version of the per-member transfer in invitation-accept:
        // catches members whose personal bytes never made it into the
        // org pool (e.g. org upgraded free → paid after they joined).
        // `.for('update')` row-locks so concurrent increment/decrement
        // calls cannot slip between the snapshot SELECT and the
        // zeroing UPDATE and get silently dropped. Idempotent — zeroed
        // rows are filtered out.
        if (isPaid(subscription.plan)) {
          try {
            const memberIds = members.map((m) => m.userId)
            await db.transaction(async (tx) => {
              const personalStorageRows = await tx
                .select({
                  userId: userStats.userId,
                  bytes: userStats.storageUsedBytes,
                })
                .from(userStats)
                .where(inArray(userStats.userId, memberIds))
                .for('update')

              const toTransfer = personalStorageRows.filter((r) => (r.bytes ?? 0) > 0)
              const totalBytes = toTransfer.reduce((acc, r) => acc + (r.bytes ?? 0), 0)

              if (totalBytes === 0) return

              await tx
                .update(organization)
                .set({
                  storageUsedBytes: sql`${organization.storageUsedBytes} + ${totalBytes}`,
                })
                .where(eq(organization.id, organizationId))

              await tx
                .update(userStats)
                .set({ storageUsedBytes: 0 })
                .where(
                  inArray(
                    userStats.userId,
                    toTransfer.map((r) => r.userId)
                  )
                )

              logger.info('Transferred personal storage bytes to org pool during sync', {
                organizationId,
                subscriptionId: subscription.id,
                memberCount: toTransfer.length,
                totalBytes,
              })
            })
          } catch (storageError) {
            logger.error('Failed to transfer personal storage to org pool', {
              organizationId,
              subscriptionId: subscription.id,
              error: storageError,
            })
          }
        }
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
