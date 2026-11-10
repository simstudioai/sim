import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { organization, subscription } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  assertNoUnresolvedEnterpriseIssuance,
  EnterpriseIssuanceInProgressError,
} from '@/lib/billing/enterprise-outbox'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isOrgPlan } from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  hasPaidSubscriptionStatus,
} from '@/lib/billing/subscriptions/utils'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

// permission-group-exempt: moving a plan onto an organization requires its current owner or admin, who sit above every group
const subscriptionTransferOperation = defineOrganizationOperation({
  id: 'billing.subscription.transfer',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

interface SubscriptionTransferInput {
  subscriptionId: string
  organizationId: string
}

interface SubscriptionTransferResult {
  transferred: boolean
  message: string
}

/**
 * Moves the caller's own Team or Enterprise subscription onto an organization they administer.
 *
 * Runs under the organization mutation lock, taken first so the move serializes with Enterprise
 * issuance and membership mutations; the subscription and organization rows are locked before the
 * caller's administrator role is checked against the same transaction.
 */
export const transferSubscriptionToOrganization: OperationUseCase<
  typeof subscriptionTransferOperation,
  SubscriptionTransferInput,
  SubscriptionTransferResult
> = {
  operation: subscriptionTransferOperation,
  async execute({ principal, input, request }) {
    const { subscriptionId, organizationId } = input
    const result = await db.transaction(async (tx): Promise<SubscriptionTransferResult> => {
      await acquireOrganizationMutationLock(tx, organizationId)

      const [sub] = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, subscriptionId))
        .for('update')
      if (!sub) throw new OrchestrationError('not_found', 'Subscription not found')
      if (!isOrgPlan(sub.plan) || !hasPaidSubscriptionStatus(sub.status)) {
        throw new OrchestrationError(
          'validation',
          'Only active Team or Enterprise subscriptions can be transferred to an organization.'
        )
      }

      const [org] = await tx
        .select({ id: organization.id, kind: organization.kind })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for('update')
      if (!org) throw new OrchestrationError('not_found', 'Organization not found')
      /** A personal organization bills its owner personally; a plan on it would never apply. */
      if (org.kind === 'personal') {
        throw new OrchestrationError(
          'validation',
          'A subscription cannot be transferred to a personal organization.'
        )
      }

      const { userId } = await authorizeOrganizationOperation(
        principal,
        subscriptionTransferOperation,
        { organizationId },
        { executor: tx }
      )

      if (sub.referenceId === organizationId) {
        return { transferred: false, message: 'Subscription already belongs to this organization' }
      }
      if (sub.referenceId !== userId) {
        throw new OrchestrationError(
          'forbidden',
          'Unauthorized - subscription does not belong to user'
        )
      }

      try {
        await assertNoUnresolvedEnterpriseIssuance(tx, organizationId)
      } catch (error) {
        if (!(error instanceof EnterpriseIssuanceInProgressError)) throw error
        throw new OrchestrationError(
          'conflict',
          'Organization has an unfinished Enterprise issuance'
        )
      }

      const [existingOrgSub] = await tx
        .select({ id: subscription.id })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, organizationId),
            inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .limit(1)
      if (existingOrgSub) {
        throw new OrchestrationError('conflict', 'Organization already has an active subscription')
      }

      await tx
        .update(subscription)
        .set({ referenceId: organizationId })
        .where(eq(subscription.id, subscriptionId))

      return { transferred: true, message: 'Subscription transferred successfully' }
    })

    if (result.transferred) {
      recordProjectedUseCaseAuditEntries(subscriptionTransferOperation, null, principal, request, [
        {
          action: AuditAction.SUBSCRIPTION_TRANSFERRED,
          resourceType: AuditResourceType.SUBSCRIPTION,
          resourceId: subscriptionId,
          description: `Subscription transferred to organization ${organizationId}`,
          metadata: {
            subscriptionId,
            organizationId,
            fromEntity: 'user',
            toEntity: 'organization',
          },
        },
      ])
    }
    return result
  },
}
