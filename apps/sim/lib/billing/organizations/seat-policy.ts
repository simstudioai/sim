import { subscription } from '@sim/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { isTeam } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'

/**
 * How admission into an organization treats seats.
 *
 * Team plans add a seat when someone joins; Enterprise buys a fixed number in
 * advance and must refuse beyond it. SSO just-in-time admission and directory
 * provisioning share this rule so a first sign-in and a directory push agree on
 * who fits, and both hand the same subscription id to the seat reconciliation
 * that follows a successful join.
 */
export async function resolveOrganizationSeatPolicyTx(
  tx: DbOrTx,
  organizationId: string
): Promise<{ skipSeatValidation?: true; organizationSubscriptionId?: string }> {
  const [entitled] = await tx
    .select({ id: subscription.id, plan: subscription.plan })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
    .orderBy(desc(subscription.periodStart), desc(subscription.id))
    .limit(1)

  return {
    ...(isTeam(entitled?.plan) ? { skipSeatValidation: true as const } : {}),
    ...(entitled?.id ? { organizationSubscriptionId: entitled.id } : {}),
  }
}
