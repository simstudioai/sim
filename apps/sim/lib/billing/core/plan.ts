import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import {
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  ENTITLED_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'

const logger = createLogger('PlanLookup')

export type HighestPrioritySubscription = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

interface GetHighestPrioritySubscriptionOptions {
  onError?: 'return-null' | 'throw'
}

function pickHighestPrioritySubscription<TSubscription>(
  subscriptions: TSubscription[],
  predicates: Array<(subscription: TSubscription) => boolean>
): TSubscription | null {
  for (const predicate of predicates) {
    const match = subscriptions.find(predicate)
    if (match) return match
  }

  return null
}

export async function getHighestPriorityPersonalSubscription(
  userId: string,
  options: GetHighestPrioritySubscriptionOptions = {}
) {
  const { onError = 'return-null' } = options
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

    return pickHighestPrioritySubscription(personalSubs, [
      checkEnterprisePlan,
      checkTeamPlan,
      checkProPlan,
    ])
  } catch (error) {
    logger.error('Error getting highest priority personal subscription', { error, userId })
    if (onError === 'throw') {
      throw error
    }
    return null
  }
}

/**
 * Get the highest priority paid subscription for a user.
 *
 * Selection order:
 *   1. Plan tier: Enterprise > Team > Pro > Free
 *   2. Within the same tier, **org-scoped subs beat personally-scoped subs**.
 *
 * The tie-break matters because a user can legitimately hold both scopes
 * at once — e.g. they accepted an org invite while their own personal Pro
 * is still in its `cancelAtPeriodEnd` grace window. In that case the org
 * is already paying for their usage, so pooled resources should win over
 * the runoff personal sub; otherwise usage, credits, and rate limits would
 * leak onto the user's row until the next billing cycle.
 */
export async function getHighestPrioritySubscription(
  userId: string,
  options: GetHighestPrioritySubscriptionOptions = {}
) {
  const { onError = 'return-null' } = options
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
      .select({ organizationId: member.organizationId })
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

    return pickHighestPrioritySubscription(
      [...orgSubs, ...personalSubs],
      [checkEnterprisePlan, checkTeamPlan, checkProPlan]
    )
  } catch (error) {
    logger.error('Error getting highest priority subscription', { error, userId })
    if (onError === 'throw') {
      throw error
    }
    return null
  }
}
