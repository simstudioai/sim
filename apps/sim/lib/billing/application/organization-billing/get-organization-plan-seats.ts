import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { count, eq } from 'drizzle-orm'
import { defineAuthorizedOrganizationBillingUseCase } from '@/lib/billing/application/organization-billing/authorized-organization-billing-use-case'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import {
  countPendingSeatInvitations,
  resolveSeatCapacity,
} from '@/lib/billing/validation/seat-management'
import { OrchestrationError } from '@/lib/core/orchestration/types'

interface OrganizationPlanSeatsInput {
  organizationId: string
}

interface OrganizationPlanSeatsResult {
  organizationId: string
  subscriptionPlan: string | null
  subscriptionStatus: string | null
  totalSeats: number
  usedSeats: number
  membersTotal: number
  hasEnterprisePlan: boolean
}

/** Primary-backed plan, feature access, and seat reservations, independent of usage analytics. */
export const getOrganizationPlanSeats = defineAuthorizedOrganizationBillingUseCase({
  operation: organizationBillingOperations.planSeats,
  organizationId: (input: OrganizationPlanSeatsInput) => input.organizationId,
  async execute({ context }): Promise<OrganizationPlanSeatsResult> {
    const { organizationId } = context
    const [organizations, subscription, memberCounts, pendingSeats, hasEnterprisePlan] =
      await Promise.all([
        db
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1),
        getOrganizationSubscription(organizationId, { executor: db, onError: 'throw' }),
        db.select({ total: count() }).from(member).where(eq(member.organizationId, organizationId)),
        countPendingSeatInvitations(organizationId, db),
        isOrganizationOnEnterprisePlan(organizationId, 'throw', db),
      ])
    if (!organizations[0]) throw new OrchestrationError('not_found', 'Organization not found')
    const membersTotal = memberCounts[0]?.total ?? 0
    return {
      organizationId,
      subscriptionPlan: subscription?.plan ?? null,
      subscriptionStatus: subscription?.status ?? null,
      totalSeats: subscription ? await resolveSeatCapacity(subscription, db) : 0,
      usedSeats: membersTotal + pendingSeats,
      membersTotal,
      hasEnterprisePlan,
    }
  },
})
