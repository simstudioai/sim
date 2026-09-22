import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { memberUsageLimitOperations } from '@/lib/billing/application/member-usage-limits/operations'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  getOrgMemberUsageForCurrentPeriod,
  getOrgMemberUsageLimit,
  isOrgMemberUsageLimitTarget,
  setOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('OrganizationMemberUsageLimits')

export interface OrganizationMemberUsageLimitInput {
  organizationId: string
  userId: string
}

export interface UpdateOrganizationMemberUsageLimitInput extends OrganizationMemberUsageLimitInput {
  creditLimit: number | null
}

/** Used before HTTP parsing as well as within the authorized application lifecycle. */
export function requireHostedMemberUsageLimits() {
  if (!isHosted) throw new OrchestrationError('not_found', 'Not found')
}

async function requireMemberUsageLimitTarget({
  input,
}: OrganizationUseCaseContext<OrganizationMemberUsageLimitInput>) {
  requireHostedMemberUsageLimits()
  if (!(await isOrgMemberUsageLimitTarget(input.organizationId, input.userId))) {
    throw new OrchestrationError('not_found', 'Member not found')
  }
}

export const getOrganizationMemberUsageLimit = defineAuthorizedOrganizationUseCase({
  operation: memberUsageLimitOperations.read,
  authorizeResource: requireMemberUsageLimitTarget,
  async execute({ input }: OrganizationUseCaseContext<OrganizationMemberUsageLimitInput>) {
    const [limitDollars, subscription] = await Promise.all([
      getOrgMemberUsageLimit(input.organizationId, input.userId),
      getOrganizationSubscription(input.organizationId),
    ])
    const used = await getOrgMemberUsageForCurrentPeriod(
      input.organizationId,
      input.userId,
      subscription
    )
    return {
      creditsUsed: dollarsToCredits(used),
      creditLimit: limitDollars === null ? null : dollarsToCredits(limitDollars),
      billingInterval: resolveBillingInterval(subscription),
    }
  },
})

export const updateOrganizationMemberUsageLimit = defineAuthorizedOrganizationUseCase({
  operation: memberUsageLimitOperations.update,
  authorizeResource: requireMemberUsageLimitTarget,
  async execute({
    principal,
    input,
    context,
  }: OrganizationUseCaseContext<UpdateOrganizationMemberUsageLimitInput>) {
    const { organizationId, userId, creditLimit } = input
    await db.transaction(async (tx) => {
      await acquireOrganizationUserMutationLocks(tx, { userId, organizationIds: [organizationId] })
      await authorizeOrganizationOperation(principal, memberUsageLimitOperations.update, input, {
        executor: tx,
        forUpdate: true,
      })
      if (
        !(await isOrgMemberUsageLimitTarget(organizationId, userId, {
          executor: tx,
          forShare: true,
        }))
      ) {
        throw new OrchestrationError('not_found', 'Member not found')
      }
      await setOrgMemberUsageLimit(
        organizationId,
        userId,
        creditLimit === null ? null : creditsToDollars(creditLimit),
        context.userId,
        tx
      )
    })
    logger.info('Updated per-member usage limit', {
      organizationId,
      memberId: userId,
      creditLimit,
      updatedBy: context.userId,
    })
    return { creditLimit }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description:
      result.creditLimit === null
        ? `Cleared credit limit for member ${input.userId}`
        : `Set credit limit for member ${input.userId} to ${result.creditLimit} credits`,
    metadata: { targetUserId: input.userId, creditLimit: result.creditLimit },
  }),
})
