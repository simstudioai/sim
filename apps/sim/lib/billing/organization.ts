import { db } from '@sim/db'
import {
  member,
  organization,
  session,
  subscription as subscriptionTable,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { hasActiveSubscription } from '@/lib/billing'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'

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

/**
 * Create a new organization and add user as owner
 * Uses transaction to ensure org + member are created atomically
 * Also updates user's active sessions to set the new org as active
 */
async function createOrganizationWithOwner(
  userId: string,
  organizationName: string,
  organizationSlug: string,
  metadata: Record<string, any> = {}
): Promise<string> {
  const orgId = `org_${crypto.randomUUID()}`
  let sessionsUpdated = 0

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: orgId,
      name: organizationName,
      slug: organizationSlug,
      metadata,
    })

    await tx.insert(member).values({
      id: crypto.randomUUID(),
      userId: userId,
      organizationId: orgId,
      role: 'owner',
    })

    const updatedSessions = await tx
      .update(session)
      .set({ activeOrganizationId: orgId })
      .where(eq(session.userId, userId))
      .returning({ id: session.id })

    sessionsUpdated = updatedSessions.length
  })

  logger.info('Created organization with owner', {
    userId,
    organizationId: orgId,
    organizationName,
    sessionsUpdated,
  })

  return orgId
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
    const slug = organizationSlug || `${userId}-team-${Date.now()}`

    const orgId = await createOrganizationWithOwner(userId, organizationName, slug, {
      createdForTeamPlan: true,
      originalUserId: userId,
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
  if (subscription.plan !== 'team') {
    return subscription
  }

  if (subscription.referenceId.startsWith('org_')) {
    return subscription
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
      if (await hasActiveSubscription(membership.organizationId)) {
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

      await db.transaction(async (tx) => {
        await tx
          .update(subscriptionTable)
          .set({ referenceId: membership.organizationId })
          .where(eq(subscriptionTable.id, subscription.id))

        await tx
          .update(session)
          .set({ activeOrganizationId: membership.organizationId })
          .where(eq(session.userId, userId))
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

    // Check if this is a user or organization subscription
    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, subscription.referenceId))
      .limit(1)

    if (users.length > 0) {
      // Individual user subscription - sync their usage limits
      await syncUsageLimitsFromSubscription(subscription.referenceId)

      logger.info('Synced usage limits for individual user subscription', {
        userId: subscription.referenceId,
        subscriptionId: subscription.id,
        plan: subscription.plan,
      })
    } else {
      // Organization subscription - set org usage limit and sync member limits
      const organizationId = subscription.referenceId

      // Set orgUsageLimit for team plans (enterprise is set via webhook with custom pricing)
      if (subscription.plan === 'team') {
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
