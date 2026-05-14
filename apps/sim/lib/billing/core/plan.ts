import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { doesOrganizationSubscriptionOwnMemberUsage } from '@/lib/billing/plan-helpers'
import {
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  ENTITLED_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'

const logger = createLogger('PlanLookup')

export type HighestPrioritySubscription = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

/**
 * Get the highest priority paid subscription for a user.
 *
 * Selection order:
 *   1. Plan tier: Enterprise > Team > Pro > Free
 *   2. Within Team/Enterprise tiers, **org-scoped subs beat personally-scoped subs**.
 *   3. Org-scoped Pro/Max applies only for org owners/admins; regular
 *      members keep their personal subscription ownership.
 *
 * The tie-break matters because a member can legitimately hold both a
 * pooled Team/Enterprise org entitlement and a personal subscription.
 * Organization-attached Pro/Max subscriptions do not pool every member.
 * They are still valid org-owned billing for owners/admins, while restored
 * personal Pro subscriptions own regular member usage after an org downgrade.
 */
export async function getHighestPrioritySubscription(userId: string) {
  try {
    const personalSubs = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, userId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )

    const memberships = await db
      .select({ organizationId: member.organizationId, role: member.role })
      .from(member)
      .where(eq(member.userId, userId))

    const orgIds = memberships.map((m: { organizationId: string }) => m.organizationId)

    let orgSubs: typeof personalSubs = []
    if (orgIds.length > 0) {
      // Verify orgs exist to filter out orphaned subscriptions
      const existingOrgs = await db
        .select({ id: organization.id })
        .from(organization)
        .where(inArray(organization.id, orgIds))

      const validOrgIds = existingOrgs.map((o) => o.id)

      if (validOrgIds.length > 0) {
        orgSubs = await db
          .select()
          .from(subscription)
          .where(
            and(
              inArray(subscription.referenceId, validOrgIds),
              inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
      }
    }

    if (personalSubs.length === 0 && orgSubs.length === 0) return null

    const roleByOrgId = new Map(memberships.map((m) => [m.organizationId, m.role]))
    const orgOwnedSubs = orgSubs.filter((sub) =>
      doesOrganizationSubscriptionOwnMemberUsage(sub.plan, roleByOrgId.get(sub.referenceId))
    )

    // Within org-owned tiers, prefer org-scoped over personally-scoped.
    const pickAtTier = (predicate: (sub: (typeof personalSubs)[number]) => boolean) =>
      orgOwnedSubs.find(predicate) ?? personalSubs.find(predicate)

    const enterpriseSub = pickAtTier(checkEnterprisePlan)
    if (enterpriseSub) return enterpriseSub

    const teamSub = pickAtTier(checkTeamPlan)
    if (teamSub) return teamSub

    const proSub = pickAtTier(checkProPlan)
    if (proSub) return proSub

    return null
  } catch (error) {
    logger.error('Error getting highest priority subscription', { error, userId })
    return null
  }
}
