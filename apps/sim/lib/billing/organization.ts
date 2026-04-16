import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { hasPaidSubscription } from '@/lib/billing'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { isOrgPlan, isTeam } from '@/lib/billing/plan-helpers'
import { attachOwnedWorkspacesToOrganization } from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('BillingOrganization')

type SubscriptionData = {
  id: string
  plan: string
  referenceId: string
  status: string
  seats?: number
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

export async function getOrganizationIdForSubscriptionReference(
  referenceId: string
): Promise<string | null> {
  const [referencedOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, referenceId))
    .limit(1)

  return referencedOrganization?.id ?? null
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
      // Check if org already has an active subscription (prevent duplicates)
      if (await hasPaidSubscription(membership.organizationId)) {
        logger.error('Organization already has an active subscription', {
          userId,
          organizationId: membership.organizationId,
          newSubscriptionId: subscription.id,
        })
        throw new Error('Organization already has an active subscription')
      }

      logger.info('User already owns/admins an org, using it', {
        userId,
        organizationId: membership.organizationId,
      })

      await db
        .update(subscriptionTable)
        .set({ referenceId: membership.organizationId })
        .where(eq(subscriptionTable.id, subscription.id))

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
      // Set orgUsageLimit for team plans (enterprise is set via webhook with custom pricing)
      if (isTeam(subscription.plan)) {
        const { basePrice } = getPlanPricing(subscription.plan)
        const seats = subscription.seats ?? 1
        const orgLimit = seats * basePrice

        // Only set if not already set or if updating to a higher value based on seats
        const orgData = await db
          .select({ orgUsageLimit: organization.orgUsageLimit })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1)

        const currentLimit =
          orgData.length > 0 && orgData[0].orgUsageLimit
            ? Number.parseFloat(orgData[0].orgUsageLimit)
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

          logger.info('Set organization usage limit for team plan', {
            organizationId,
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
