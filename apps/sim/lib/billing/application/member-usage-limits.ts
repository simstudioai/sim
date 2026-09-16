import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { organizationBillingSettingsActor } from '@/lib/billing/application/organization-settings-actor'
import { memberCreditLimitUpdateSchema } from '@/lib/billing/application/usage-limit-validation'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  getOrgMemberUsageForCurrentPeriod,
  getOrgMemberUsageLimit,
  setOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'
import type { OperationUseCase } from '@/lib/core/application'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('OrgMemberUsageLimit')

const policy = {
  minimumRole: 'admin',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
  /** permission-group-exempt: organization billing administrators manage member budgets outside permission-group capabilities. */
  capability: 'none',
} as const
export const memberUsageLimitOperations = {
  // permission-group-exempt: organization billing administrators manage member budgets outside permission-group capabilities.
  read: defineOrganizationOperation({
    ...policy,
    id: 'billing.member_usage_limit.read',
    capability: 'none',
  }),
  // permission-group-exempt: organization billing administrators manage member budgets outside permission-group capabilities.
  update: defineOrganizationOperation({
    ...policy,
    id: 'billing.member_usage_limit.update',
    capability: 'none',
  }),
} as const
export function requireHostedMemberUsageLimits() {
  if (!isHosted) throw new OrchestrationError('not_found', 'Not found')
}
async function authorizeMemberUsageLimit(
  principal: Principal,
  operation: OrganizationOperation,
  organizationId: string
) {
  if (principal.kind !== 'session' && principal.kind !== 'organization_delegated')
    throw new OrchestrationError('forbidden', 'Organization billing delegation is required')
  requireHostedMemberUsageLimits()
  const actorId = await organizationBillingSettingsActor(principal, operation, organizationId)
  if (!(await isOrganizationOwnerOrAdmin(actorId, organizationId)))
    throw new OrchestrationError('forbidden', 'Forbidden - Admin access required')
  return actorId
}
interface MemberInput {
  organizationId: string
  userId: string
}

export const readMemberUsageLimit: OperationUseCase<
  typeof memberUsageLimitOperations.read,
  MemberInput,
  { creditsUsed: number; creditLimit: number | null; billingInterval: 'month' | 'year' }
> = {
  operation: memberUsageLimitOperations.read,
  async execute({ principal, input }) {
    await authorizeMemberUsageLimit(
      principal,
      memberUsageLimitOperations.read,
      input.organizationId
    )
    const [limitDollars, subscription] = await Promise.all([
      getOrgMemberUsageLimit(input.organizationId, input.userId),
      getOrganizationSubscription(input.organizationId),
    ])
    const usage = await getOrgMemberUsageForCurrentPeriod(
      input.organizationId,
      input.userId,
      subscription
    )
    return {
      creditsUsed: dollarsToCredits(usage),
      creditLimit: limitDollars === null ? null : dollarsToCredits(limitDollars),
      billingInterval: resolveBillingInterval(subscription),
    }
  },
}

export const updateMemberUsageLimit: OperationUseCase<
  typeof memberUsageLimitOperations.update,
  MemberInput & { creditLimit: number | null },
  { creditLimit: number | null }
> = {
  operation: memberUsageLimitOperations.update,
  async execute({ principal, input, request }) {
    const actorId = await authorizeMemberUsageLimit(
      principal,
      memberUsageLimitOperations.update,
      input.organizationId
    )
    const parsed = memberCreditLimitUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        parsed.error.issues[0]?.message ?? 'Invalid credit limit'
      )
    const { creditLimit } = parsed.data
    const [actor] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, actorId))
      .limit(1)
    await setOrgMemberUsageLimit(
      input.organizationId,
      input.userId,
      creditLimit === null ? null : creditsToDollars(creditLimit),
      actorId
    )
    logger.info('Updated per-member usage limit', {
      organizationId: input.organizationId,
      memberId: input.userId,
      creditLimit,
      updatedBy: actorId,
    })
    recordAudit({
      workspaceId: null,
      actorId,
      actorName: actor?.name,
      actorEmail: actor?.email,
      action: AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: input.organizationId,
      description:
        creditLimit === null
          ? `Cleared credit limit for member ${input.userId}`
          : `Set credit limit for member ${input.userId} to ${creditLimit} credits`,
      metadata: {
        targetUserId: input.userId,
        creditLimit,
        operation: memberUsageLimitOperations.update.id,
        actor: resolvePrincipalAuditAttribution(principal).actor,
      },
      request,
    })
    return { creditLimit }
  },
}
