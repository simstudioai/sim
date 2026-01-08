import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { checkEnterprisePlan, checkProPlan, checkTeamPlan } from '@/lib/billing/subscriptions/utils'

const logger = createLogger('PlanLookup')

/**
 * Get the highest priority active subscription for a user
 * Priority: Enterprise > Team > Pro > Free
 */
export async function getHighestPrioritySubscription(userId: string) {
  try {
    const personalSubs = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))

    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    const orgIds = memberships.map((m: { organizationId: string }) => m.organizationId)

    let orgSubs: typeof personalSubs = []
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
  } catch (error) {
    logger.error('Error getting highest priority subscription', { error, userId })
    return null
  }
}
