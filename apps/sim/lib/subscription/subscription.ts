import { and, eq, inArray } from 'drizzle-orm'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, subscription, userStats } from '@/db/schema'
import { client } from '../auth-client'
import { env } from '../env'
import { calculateUsageLimit, checkEnterprisePlan, checkProPlan, checkTeamPlan } from './utils'

const logger = createLogger('Subscription')

export async function isProPlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const directSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, userId))

    const hasDirectProPlan = directSubscriptions.some(checkProPlan)

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

export async function isTeamPlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const memberships = await db.select().from(member).where(eq(member.userId, userId))

    for (const membership of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(subscription)
        .where(eq(subscription.referenceId, membership.organizationId))

      const orgHasTeamPlan = orgSubscriptions.some(
        (sub) => sub.status === 'active' && sub.plan === 'team'
      )

      if (orgHasTeamPlan) {
        return true
      }
    }

    const directSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, userId))

    const hasDirectTeamPlan = directSubscriptions.some(checkTeamPlan)

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

export async function isEnterprisePlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const memberships = await db.select().from(member).where(eq(member.userId, userId))

    for (const membership of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(subscription)
        .where(eq(subscription.referenceId, membership.organizationId))

      const orgHasEnterprisePlan = orgSubscriptions.some((sub) => checkEnterprisePlan(sub))

      if (orgHasEnterprisePlan) {
        logger.info('User has enterprise plan via organization', {
          userId,
          orgId: membership.organizationId,
        })
        return true
      }
    }

    const directSubscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, userId))

    const hasDirectEnterprisePlan = directSubscriptions.some(checkEnterprisePlan)

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

export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return false
    }

    let activeSubscription = null

    const userSubscriptions = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))

    if (userSubscriptions.length > 0) {
      const enterpriseSub = userSubscriptions.find(checkEnterprisePlan)
      const teamSub = userSubscriptions.find(checkTeamPlan)
      const proSub = userSubscriptions.find(checkProPlan)

      activeSubscription = enterpriseSub || teamSub || proSub || null
    }

    if (!activeSubscription) {
      const memberships = await db.select().from(member).where(eq(member.userId, userId))

      for (const membership of memberships) {
        const orgId = membership.organizationId

        const orgSubscriptions = await db
          .select()
          .from(subscription)
          .where(and(eq(subscription.referenceId, orgId), eq(subscription.status, 'active')))

        if (orgSubscriptions.length > 0) {
          const orgEnterpriseSub = orgSubscriptions.find(checkEnterprisePlan)
          const orgTeamSub = orgSubscriptions.find(checkTeamPlan)
          const orgProSub = orgSubscriptions.find(checkProPlan)

          activeSubscription = orgEnterpriseSub || orgTeamSub || orgProSub || null
          if (activeSubscription) break
        }
      }
    }

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
      limit = env.FREE_TIER_COST_LIMIT || 5
      logger.info('Using free tier limit', { userId, limit })
    }

    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (statsRecords.length === 0) {
      return false
    }

    const currentCost = Number.parseFloat(statsRecords[0].totalCost.toString())

    logger.info('Checking cost limit', { userId, currentCost, limit })

    return currentCost >= limit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

export async function isSharingEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    if (activeDirectSubscription?.limits?.sharingEnabled) {
      return true
    }

    const memberships = await db.select().from(member).where(eq(member.userId, userId))

    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription?.limits?.sharingEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking sharing permission', { error, userId })
    return false // Be conservative in case of error
  }
}

export async function isMultiplayerEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    if (activeDirectSubscription?.limits?.multiplayerEnabled) {
      return true
    }

    const memberships = await db.select().from(member).where(eq(member.userId, userId))

    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription?.limits?.multiplayerEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking multiplayer permission', { error, userId })
    return false // Be conservative in case of error
  }
}

export async function isWorkspaceCollaborationEnabled(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return true
    }

    const { data: directSubscriptions } = await client.subscription.list({
      query: { referenceId: userId },
    })

    const activeDirectSubscription = directSubscriptions?.find((sub) => sub.status === 'active')

    if (activeDirectSubscription?.limits?.workspaceCollaborationEnabled) {
      return true
    }

    const memberships = await db.select().from(member).where(eq(member.userId, userId))

    // Check each organization for a subscription with workspace collaboration enabled
    for (const membership of memberships) {
      const { data: orgSubscriptions } = await client.subscription.list({
        query: { referenceId: membership.organizationId },
      })

      const activeOrgSubscription = orgSubscriptions?.find((sub) => sub.status === 'active')

      if (activeOrgSubscription?.limits?.workspaceCollaborationEnabled) {
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Error checking workspace collaboration permission', { error, userId })
    return false // Be conservative in case of error
  }
}

export async function getHighestPrioritySubscription(userId: string) {
  const personalSubs = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))

  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  const orgIds = memberships.map((m: { organizationId: string }) => m.organizationId)

  let orgSubs: any[] = []
  if (orgIds.length > 0) {
    orgSubs = await db
      .select()
      .from(subscription)
      .where(and(inArray(subscription.referenceId, orgIds), eq(subscription.status, 'active')))
  }

  const allSubs = [...personalSubs, ...orgSubs]

  if (allSubs.length === 0) return null

  const enterpriseSub = allSubs.find((s) => checkEnterprisePlan(s))
  if (enterpriseSub) return enterpriseSub

  const teamSub = allSubs.find((s) => checkTeamPlan(s))
  if (teamSub) return teamSub

  const proSub = allSubs.find((s) => checkProPlan(s))
  if (proSub) return proSub

  return null
}
