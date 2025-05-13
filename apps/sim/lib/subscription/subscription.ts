import { and, eq } from 'drizzle-orm'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { client } from '../auth-client'
import { calculateUsageLimit } from './utils'
import { checkEnterprisePlan } from './utils'

const logger = createLogger('Subscription')

/**
 * Check if the user is on the Pro plan
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    // In development, enable Pro features for easier testing
    if (!isProd) {
      return true
    }

    // First check organizations the user belongs to (prioritize org subscriptions)
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for active Pro or Team subscriptions
    for (const membership of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, membership.organizationId))

      const orgHasProPlan = orgSubscriptions.some(
        (sub) => sub.status === 'active' && (sub.plan === 'pro' || sub.plan === 'team')
      )

      if (orgHasProPlan) {
        logger.info('User has pro plan via organization', {
          userId,
          orgId: membership.organizationId,
        })
        return true
      }
    }

    // If no org subscriptions, check direct subscriptions
    const directSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, userId))

    // Find active pro subscription (either Pro or Team plan)
    const hasDirectProPlan = directSubscriptions.some(
      (sub) => sub.status === 'active' && (sub.plan === 'pro' || sub.plan === 'team')
    )

    if (hasDirectProPlan) {
      logger.info('User has direct pro plan', { userId })
      return true
    }

    return false
  } catch (error) {
    logger.error('Error checking pro plan status', { error, userId })
    return false
  }
}

/**
 * Check if the user is on the Team plan
 */
export async function isTeamPlan(userId: string): Promise<boolean> {
  try {
    // In development, enable Team features for easier testing
    if (!isProd) {
      return true
    }

    // First check organizations the user belongs to (prioritize org subscriptions)
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for active Team subscriptions
    for (const membership of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, membership.organizationId))

      const orgHasTeamPlan = orgSubscriptions.some(
        (sub) => sub.status === 'active' && sub.plan === 'team'
      )

      if (orgHasTeamPlan) {
        return true
      }
    }

    // If no org subscriptions found, check direct subscriptions
    const directSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, userId))

    // Find active team subscription
    const hasDirectTeamPlan = directSubscriptions.some(
      (sub) => sub.status === 'active' && sub.plan === 'team'
    )

    if (hasDirectTeamPlan) {
      logger.info('User has direct team plan', { userId })
      return true
    }

    return false
  } catch (error) {
    logger.error('Error checking team plan status', { error, userId })
    return false
  }
}

/**
 * Check if the user is on the Enterprise plan
 */
export async function isEnterprisePlan(userId: string): Promise<boolean> {
  try {
    // In development, enable Enterprise features for easier testing
    if (!isProd) {
      return true
    }

    // First check organizations the user belongs to (prioritize org subscriptions)
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for active Enterprise subscriptions
    for (const membership of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, membership.organizationId))

      const orgHasEnterprisePlan = orgSubscriptions.some(
        (sub) => sub.status === 'active' && sub.plan === 'enterprise'
      )

      if (orgHasEnterprisePlan) {
        logger.info('User has enterprise plan via organization', {
          userId,
          orgId: membership.organizationId,
        })
        return true
      }
    }

    // If no org subscriptions found, check direct subscriptions
    const directSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, userId))

    // Find active enterprise subscription
    const hasDirectEnterprisePlan = directSubscriptions.some(
      (sub) => sub.status === 'active' && sub.plan === 'enterprise'
    )

    if (hasDirectEnterprisePlan) {
      logger.info('User has direct enterprise plan', { userId })
      return true
    }

    return false
  } catch (error) {
    logger.error('Error checking enterprise plan status', { error, userId })
    return false
  }
}

/**
 * Check if a user has exceeded their cost limit based on their subscription plan
 */
export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    // In development, users never exceed their limit
    if (!isProd) {
      return false
    }

    // Get all applicable subscriptions for the user
    let activeSubscription = null

    // First check for direct subscription
    const userSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(
        and(eq(schema.subscription.referenceId, userId), eq(schema.subscription.status, 'active'))
      )

    if (userSubscriptions.length > 0) {
      activeSubscription = userSubscriptions[0]
    }

    // If no direct subscription, check for organization subscriptions
    if (!activeSubscription) {
      const memberships = await db
        .select()
        .from(schema.member)
        .where(eq(schema.member.userId, userId))

      for (const membership of memberships) {
        const orgId = membership.organizationId

        const orgSubscriptions = await db
          .select()
          .from(schema.subscription)
          .where(
            and(
              eq(schema.subscription.referenceId, orgId),
              eq(schema.subscription.status, 'active')
            )
          )

        if (orgSubscriptions.length > 0) {
          // Prioritize enterprise, then team, then pro plans
          const enterpriseSub = orgSubscriptions.find((sub) => checkEnterprisePlan(sub))
          const teamSub = orgSubscriptions.find(
            (sub) => sub.plan === 'team' && sub.status === 'active'
          )
          const proSub = orgSubscriptions.find(
            (sub) => sub.plan === 'pro' && sub.status === 'active'
          )

          // Use the highest tier subscription
          activeSubscription = enterpriseSub || teamSub || proSub || null
          if (activeSubscription) break
        }
      }
    }

    // Calculate limit using our standardized function
    let limit = 0
    if (activeSubscription) {
      limit = calculateUsageLimit(activeSubscription)
      logger.info('Using calculated subscription limit', {
        userId,
        plan: activeSubscription.plan,
        seats: activeSubscription.seats || 1,
        limit,
      })
    } else {
      // Free tier limit
      limit = process.env.FREE_TIER_COST_LIMIT ? parseFloat(process.env.FREE_TIER_COST_LIMIT) : 5
      logger.info('Using free tier limit', { userId, limit })
    }

    // Get user's actual usage from the database
    const statsRecords = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))

    if (statsRecords.length === 0) {
      // No usage yet, so they haven't exceeded the limit
      return false
    }

    // Get the current cost and compare with the limit
    const currentCost = parseFloat(statsRecords[0].totalCost.toString())

    logger.info('Checking cost limit', { userId, currentCost, limit })

    return currentCost >= limit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if a user is allowed to share workflows based on their subscription plan
 */
export async function isSharingEnabled(userId: string): Promise<boolean> {
  try {
    // In development, always allow sharing
    if (!isProd) {
      return true
    }

    // Check direct subscription
    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    // If user has direct pro/team subscription with sharing enabled
    if (activeDirectSubscription && activeDirectSubscription.limits?.sharingEnabled) {
      return true
    }

    // Check organizations the user belongs to
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for a subscription with sharing enabled
    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription && activeOrgSubscription.limits?.sharingEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking sharing permission', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if multiplayer collaboration is enabled for the user
 */
export async function isMultiplayerEnabled(userId: string): Promise<boolean> {
  try {
    // In development, always enable multiplayer
    if (!isProd) {
      return true
    }

    // Check direct subscription
    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    // If user has direct team subscription with multiplayer enabled
    if (activeDirectSubscription && activeDirectSubscription.limits?.multiplayerEnabled) {
      return true
    }

    // Check organizations the user belongs to
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for a subscription with multiplayer enabled
    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription && activeOrgSubscription.limits?.multiplayerEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking multiplayer permission', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if workspace collaboration is enabled for the user
 */
export async function isWorkspaceCollaborationEnabled(userId: string): Promise<boolean> {
  try {
    // In development, always enable workspace collaboration
    if (!isProd) {
      return true
    }

    // Check direct subscription
    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    // If user has direct team subscription with workspace collaboration enabled
    if (
      activeDirectSubscription &&
      activeDirectSubscription.limits?.workspaceCollaborationEnabled
    ) {
      return true
    }

    // Check organizations the user belongs to
    const memberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, userId))

    // Check each organization for a subscription with workspace collaboration enabled
    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription && activeOrgSubscription.limits?.workspaceCollaborationEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking workspace collaboration permission', { error, userId })
    return false // Be conservative in case of error
  }
}
