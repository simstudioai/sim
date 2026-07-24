import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { isEnterprise, isTeam } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'

/**
 * Returns whether another entitled Team or Enterprise subscription still covers
 * the organization after a specific subscription ends.
 */
export async function hasOtherEntitledOrganizationSubscription(
  organizationId: string,
  excludeSubscriptionId: string | null
): Promise<boolean> {
  const filters = [
    eq(subscription.referenceId, organizationId),
    inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
  ]
  if (excludeSubscriptionId) {
    filters.push(ne(subscription.id, excludeSubscriptionId))
  }

  const rows = await db
    .select({ plan: subscription.plan })
    .from(subscription)
    .where(and(...filters))

  return rows.some(({ plan }) => isTeam(plan) || isEnterprise(plan))
}
