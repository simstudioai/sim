import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, getTableColumns, inArray } from 'drizzle-orm'
import {
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  ENTITLED_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import type { DbClient, DbOrTx } from '@/lib/db/types'

const logger = createLogger('PlanLookup')

export type HighestPrioritySubscription = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

interface GetHighestPrioritySubscriptionOptions {
  onError?: 'return-null' | 'throw'
  /** Primary/replica client or a caller-owned enforcement transaction. */
  executor?: DbClient | DbOrTx
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
  const { onError = 'return-null', executor = db } = options
  try {
    const personalSubs = await executor
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
  const { onError = 'return-null', executor = db } = options
  try {
    const entitled = inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
    const [personalSubs, orgSubs] = await Promise.all([
      executor
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, userId), entitled)),
      // The `organization` join keeps orphaned memberships from contributing a subscription.
      executor
        .select(getTableColumns(subscription))
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .innerJoin(subscription, eq(subscription.referenceId, organization.id))
        .where(and(eq(member.userId, userId), entitled)),
    ])

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
