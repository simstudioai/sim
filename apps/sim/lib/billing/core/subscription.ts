import { and, eq, inArray } from 'drizzle-orm'
import { client } from '@/lib/auth-client'
import {
  calculateDefaultUsageLimit,
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
} from '@/lib/billing/subscriptions/utils'
import type { UserSubscriptionState } from '@/lib/billing/types'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, subscription, userStats } from '@/db/schema'

const logger = createLogger('SubscriptionCore')

/**
 * Core subscription management - single source of truth
 * Consolidates logic from both lib/subscription.ts and lib/subscription/subscription.ts
 */

/**
 * Get the highest priority active subscription for a user
 * Priority: Enterprise > Team > Pro > Free
 */
export async function getHighestPrioritySubscription(userId: string) {
  try {
    // Get direct subscriptions
    const personalSubs = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))

    // Get organization memberships
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    const orgIds = memberships.map((m: { organizationId: string }) => m.organizationId)

    // Get organization subscriptions
    let orgSubs: any[] = []
    if (orgIds.length > 0) {
      orgSubs = await db
        .select()
        .from(subscription)
        .where(and(inArray(subscription.referenceId, orgIds), eq(subscription.status, 'active')))
    }

    const allSubs = [...personalSubs, ...orgSubs]

    if (allSubs.length === 0) return null

    // Return highest priority subscription
    const enterpriseSub = allSubs.find((s) => checkEnterprisePlan(s))
    if (enterpriseSub) return enterpriseSub

    const teamSub = allSubs.find((s) => checkTeamPlan(s))
    if (teamSub) return teamSub

    const proSub = allSubs.find((s) => checkProPlan(s))
    if (proSub) return proSub

    return null
  } catch (error) {
    logger.error('Error getting highest priority subscription', { error, userId })
    return null
  }
}

/**
 * Check if user is on Pro plan (direct or via organization)
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    // In development, enable Pro features for easier testing
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isPro =
      subscription &&
      (checkProPlan(subscription) ||
        checkTeamPlan(subscription) ||
        checkEnterprisePlan(subscription))

    if (isPro) {
      logger.info('User has pro-level plan', { userId, plan: subscription.plan })
    }

    return !!isPro
  } catch (error) {
    logger.error('Error checking pro plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Team plan (direct or via organization)
 */
export async function isTeamPlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isTeam =
      subscription && (checkTeamPlan(subscription) || checkEnterprisePlan(subscription))

    if (isTeam) {
      logger.info('User has team-level plan', { userId, plan: subscription.plan })
    }

    return !!isTeam
  } catch (error) {
    logger.error('Error checking team plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Enterprise plan (direct or via organization)
 */
export async function isEnterprisePlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isEnterprise = subscription && checkEnterprisePlan(subscription)

    if (isEnterprise) {
      logger.info('User has enterprise plan', { userId, plan: subscription.plan })
    }

    return !!isEnterprise
  } catch (error) {
    logger.error('Error checking enterprise plan status', { error, userId })
    return false
  }
}

/**
 * Check if user has exceeded their cost limit based on current period usage
 */
export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return false
    }

    const subscription = await getHighestPrioritySubscription(userId)

    // Calculate usage limit
    let limit = 5 // Default free tier limit
    if (subscription) {
      limit = calculateDefaultUsageLimit(subscription)
      logger.info('Using subscription-based limit', {
        userId,
        plan: subscription.plan,
        seats: subscription.seats || 1,
        limit,
      })
    } else {
      logger.info('Using free tier limit', { userId, limit })
    }

    // Get user stats to check current period usage
    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (statsRecords.length === 0) {
      return false
    }

    // Use current period cost instead of total cost for accurate billing period tracking
    const currentCost = Number.parseFloat(
      statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
    )

    logger.info('Checking cost limit', { userId, currentCost, limit })

    return currentCost >= limit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if sharing features are enabled for user
 */
export async function isSharingEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)

    if (!subscription) {
      return false // Free users don't have sharing
    }

    // Use Better-Auth client to check feature flags
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: subscription.referenceId },
    })

    const activeSubscription = subscriptions?.find((sub) => sub.status === 'active')
    return !!activeSubscription?.limits?.sharingEnabled
  } catch (error) {
    logger.error('Error checking sharing permission', { error, userId })
    return false
  }
}

/**
 * Check if multiplayer features are enabled for user
 */
export async function isMultiplayerEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)

    if (!subscription) {
      return false // Free users don't have multiplayer
    }

    // Use Better-Auth client to check feature flags
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: subscription.referenceId },
    })

    const activeSubscription = subscriptions?.find((sub) => sub.status === 'active')
    return !!activeSubscription?.limits?.multiplayerEnabled
  } catch (error) {
    logger.error('Error checking multiplayer permission', { error, userId })
    return false
  }
}

/**
 * Check if workspace collaboration features are enabled for user
 */
export async function isWorkspaceCollaborationEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)

    if (!subscription) {
      return false // Free users don't have workspace collaboration
    }

    // Use Better-Auth client to check feature flags
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: subscription.referenceId },
    })

    const activeSubscription = subscriptions?.find((sub) => sub.status === 'active')
    return !!activeSubscription?.limits?.workspaceCollaborationEnabled
  } catch (error) {
    logger.error('Error checking workspace collaboration permission', { error, userId })
    return false
  }
}

/**
 * Get comprehensive subscription state for a user
 * Single function to get all subscription information
 */
export async function getUserSubscriptionState(userId: string): Promise<UserSubscriptionState> {
  try {
    // Get subscription and user stats in parallel to minimize DB calls
    const [subscription, statsRecords] = await Promise.all([
      getHighestPrioritySubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    // Determine plan types based on subscription (avoid redundant DB calls)
    const isPro =
      !isProd ||
      (subscription &&
        (checkProPlan(subscription) ||
          checkTeamPlan(subscription) ||
          checkEnterprisePlan(subscription)))
    const isTeam =
      !isProd ||
      (subscription && (checkTeamPlan(subscription) || checkEnterprisePlan(subscription)))
    const isEnterprise = !isProd || (subscription && checkEnterprisePlan(subscription))
    const isFree = !isPro && !isTeam && !isEnterprise

    // Determine plan name
    let planName = 'free'
    if (isEnterprise) planName = 'enterprise'
    else if (isTeam) planName = 'team'
    else if (isPro) planName = 'pro'

    // Check features based on subscription (avoid redundant better-auth calls)
    let sharingEnabled = false
    let multiplayerEnabled = false
    let workspaceCollaborationEnabled = false

    if (!isProd || subscription) {
      if (!isProd) {
        // Development mode - enable all features
        sharingEnabled = true
        multiplayerEnabled = true
        workspaceCollaborationEnabled = true
      } else {
        // Production mode - check subscription features
        try {
          const { data: subscriptions } = await client.subscription.list({
            query: { referenceId: subscription.referenceId },
          })
          const activeSubscription = subscriptions?.find((sub) => sub.status === 'active')

          sharingEnabled = !!activeSubscription?.limits?.sharingEnabled
          multiplayerEnabled = !!activeSubscription?.limits?.multiplayerEnabled
          workspaceCollaborationEnabled =
            !!activeSubscription?.limits?.workspaceCollaborationEnabled
        } catch (error) {
          logger.error('Error checking subscription features', { error, userId })
          // Default to false on error
        }
      }
    }

    // Check cost limit using already-fetched user stats
    let hasExceededLimit = false
    if (isProd && statsRecords.length > 0) {
      let limit = 5 // Default free tier limit
      if (subscription) {
        limit = calculateDefaultUsageLimit(subscription)
      }

      const currentCost = Number.parseFloat(
        statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
      )
      hasExceededLimit = currentCost >= limit
    }

    return {
      isPro,
      isTeam,
      isEnterprise,
      isFree,
      highestPrioritySubscription: subscription,
      features: {
        sharingEnabled,
        multiplayerEnabled,
        workspaceCollaborationEnabled,
      },
      hasExceededLimit,
      planName,
    }
  } catch (error) {
    logger.error('Error getting user subscription state', { error, userId })

    // Return safe defaults in case of error
    return {
      isPro: false,
      isTeam: false,
      isEnterprise: false,
      isFree: true,
      highestPrioritySubscription: null,
      features: {
        sharingEnabled: false,
        multiplayerEnabled: false,
        workspaceCollaborationEnabled: false,
      },
      hasExceededLimit: false,
      planName: 'free',
    }
  }
}
