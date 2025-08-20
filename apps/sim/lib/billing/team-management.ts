import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, organization, session, subscription, user } from '@/db/schema'

const logger = createLogger('TeamManagement')

type SubscriptionData = {
  id: string
  plan: string
  referenceId: string
  status: string
  seats?: number
  [key: string]: any
}

/**
 * Auto-create organization for team plan subscriptions
 */
export async function handleTeamPlanOrganization(
  subscriptionData: SubscriptionData
): Promise<void> {
  if (subscriptionData.plan !== 'team') return

  try {
    // For team subscriptions, referenceId should be the user ID initially
    // But if the organization has already been created, it might be the org ID
    let userId: string = subscriptionData.referenceId
    let currentUser: any = null

    // First try to get user directly (most common case)
    const users = await db
      .select()
      .from(user)
      .where(eq(user.id, subscriptionData.referenceId))
      .limit(1)

    if (users.length > 0) {
      currentUser = users[0]
      userId = currentUser.id
    } else {
      // If referenceId is not a user ID, it might be an organization ID
      // In that case, the organization already exists, so we should skip
      const existingOrg = await db
        .select()
        .from(organization)
        .where(eq(organization.id, subscriptionData.referenceId))
        .limit(1)

      if (existingOrg.length > 0) {
        logger.info('Organization already exists for team subscription, skipping creation', {
          organizationId: subscriptionData.referenceId,
          subscriptionId: subscriptionData.id,
        })
        return
      }

      logger.warn('User not found for team subscription and no existing organization', {
        referenceId: subscriptionData.referenceId,
      })
      return
    }

    // Check if user already has an organization membership
    const existingMember = await db.select().from(member).where(eq(member.userId, userId)).limit(1)

    if (existingMember.length > 0) {
      logger.info('User already has organization membership, skipping auto-creation', {
        userId,
        existingOrgId: existingMember[0].organizationId,
      })
      return
    }

    const orgName = `${currentUser.name || 'User'}'s Team`
    const orgSlug = `${currentUser.name?.toLowerCase().replace(/\s+/g, '-') || 'team'}-${Date.now()}`

    // Create organization directly in database
    const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

    const [createdOrg] = await db
      .insert(organization)
      .values({
        id: orgId,
        name: orgName,
        slug: orgSlug,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (!createdOrg) {
      throw new Error('Failed to create organization in database')
    }

    // Add the user as admin of the organization (owner role for full control)
    await db.insert(member).values({
      id: `member_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      userId: currentUser.id,
      organizationId: orgId,
      role: 'owner', // Owner gives full admin privileges
      createdAt: new Date(),
    })

    // Update the subscription to reference the organization instead of the user
    await db
      .update(subscription)
      .set({ referenceId: orgId })
      .where(eq(subscription.id, subscriptionData.id))

    // Update the user's session to set the new organization as active
    await db
      .update(session)
      .set({ activeOrganizationId: orgId })
      .where(eq(session.userId, currentUser.id))

    logger.info('Auto-created organization for team subscription', {
      organizationId: orgId,
      userId: currentUser.id,
      subscriptionId: subscriptionData.id,
      orgName,
      userRole: 'owner',
    })

    // Update subscription object for subsequent logic
    subscriptionData.referenceId = orgId
  } catch (error) {
    logger.error('Failed to auto-create organization for team subscription', {
      subscriptionId: subscriptionData.id,
      referenceId: subscriptionData.referenceId,
      error,
    })
    throw error
  }
}

/**
 * Sync usage limits for user or organization
 * Handles the complexity of determining whether to sync for user ID or org members
 */
export async function syncSubscriptionUsageLimits(
  subscriptionData: SubscriptionData
): Promise<void> {
  try {
    const { syncUsageLimitsFromSubscription } = await import('@/lib/billing')

    // For team plans, the referenceId is now an organization ID
    // We need to sync limits for the organization members
    if (subscriptionData.plan === 'team') {
      // Get all members of the organization
      const orgMembers = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, subscriptionData.referenceId))

      // Sync usage limits for each member
      for (const orgMember of orgMembers) {
        await syncUsageLimitsFromSubscription(orgMember.userId)
      }

      logger.info('Synced usage limits for team organization members', {
        organizationId: subscriptionData.referenceId,
        memberCount: orgMembers.length,
      })
    } else {
      // For non-team plans, referenceId is the user ID
      await syncUsageLimitsFromSubscription(subscriptionData.referenceId)
      logger.info('Synced usage limits for user', {
        userId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
      })
    }
  } catch (error) {
    logger.error('Failed to sync subscription usage limits', {
      subscriptionId: subscriptionData.id,
      referenceId: subscriptionData.referenceId,
      error,
    })
    throw error
  }
}
