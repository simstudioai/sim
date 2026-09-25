import type { Principal } from '@sim/auth/principal'
import { dbReplica } from '@sim/db'
import { getUserUsageLimitInfo, updateUserUsageLimit } from '@/lib/billing'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary'
import { organizationBillingSettingsActor } from '@/lib/billing/application/organization-settings-actor'
import {
  type UsageLimitReadInput,
  type UsageLimitUpdateInput,
  usageLimitReadSchema,
  usageLimitUpdateSchema,
} from '@/lib/billing/application/usage-limit-validation'
import {
  getOrganizationBillingData,
  isOrganizationOwnerOrAdmin,
  updateOrganizationUsageLimit,
} from '@/lib/billing/core/organization'
import { assertOperationCapability, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { UserAccountOperation } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'

function defineUsageLimitOperation<const Id extends string>(id: Id) {
  /** permission-group-exempt: usage caps belong to the current account or an administered billing organization. */
  const operation = {
    id,
    capability: 'none',
    principalKinds: Object.freeze(['session', 'delegated', 'organization_delegated'] as const),
    delegationAudience: 'sim:settings',
  } satisfies UserAccountOperation
  assertOperationCapability(operation)
  return Object.freeze(operation)
}
export const usageLimitOperations = {
  // permission-group-exempt: usage caps are account or billing administrator controls.
  read: defineUsageLimitOperation('billing.usage_limits.read'),
  // permission-group-exempt: usage caps are account or billing administrator controls.
  update: defineUsageLimitOperation('billing.usage_limits.update'),
} as const
async function organizationActor(
  principal: Principal,
  operation: UserAccountOperation,
  organizationId: string
) {
  if (principal.kind !== 'session' && principal.kind !== 'organization_delegated')
    throw new OrchestrationError('forbidden', 'Organization billing delegation is required')
  const userId = await organizationBillingSettingsActor(principal, operation, organizationId)
  if (!(await isOrganizationOwnerOrAdmin(userId, organizationId)))
    throw new OrchestrationError('forbidden', 'Permission denied')
  return userId
}
type PersonalResult = {
  success: true
  context: 'user'
  userId: string
  organizationId: string | null
  data: Awaited<ReturnType<typeof getUserUsageLimitInfo>>
}
type OrganizationResult = {
  success: true
  context: 'organization'
  userId: string
  organizationId: string
  data: Awaited<ReturnType<typeof loadOrganizationLimitData>>
}
export type UsageLimitResult = PersonalResult | OrganizationResult

async function loadOrganizationLimitData(
  principal: Principal,
  organizationId: string,
  pagination?: { limit: number; offset: number }
) {
  const data = pagination
    ? await getOrganizationBillingData(organizationId, dbReplica, pagination)
    : await getOrganizationBillingData(organizationId)
  if (!data) return null
  const summary = await getOrganizationBillingSummary.execute({
    principal,
    input: { organizationId },
  })
  return {
    ...data,
    subscriptionState: summary.subscriptionState,
    hasSubscription: summary.subscriptionStatus !== null,
    creditBalance: summary.creditBalance,
    billingInterval: summary.billingInterval,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    billingBlocked: summary.billingBlocked,
    billingBlockedReason: summary.billingBlockedReason,
    blockedByOrgOwner: summary.blockedByOrgOwner,
    upgradeWorkspaceId: summary.upgradeWorkspaceId,
  }
}

/** Reads the same budget data that backs the account and organization cap controls. */
export const readUsageLimit: OperationUseCase<
  typeof usageLimitOperations.read,
  UsageLimitReadInput,
  UsageLimitResult
> = {
  operation: usageLimitOperations.read,
  async execute({ principal, input }) {
    const parsed = usageLimitReadSchema.safeParse(input)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        parsed.error.issues[0]?.message ?? 'Invalid usage limit request'
      )
    const query = parsed.data
    if (query.context === 'organization') {
      if (!query.organizationId)
        throw new OrchestrationError(
          'validation',
          'Organization ID is required when context=organization'
        )
      const actorId = await organizationActor(
        principal,
        usageLimitOperations.read,
        query.organizationId
      )
      if (principal.kind === 'organization_delegated' && query.userId && query.userId !== actorId)
        throw new OrchestrationError(
          'forbidden',
          'Usage actor must match the authenticated account'
        )
      const data = await loadOrganizationLimitData(principal, query.organizationId, {
        limit: query.memberLimit,
        offset: query.memberOffset,
      })
      return {
        success: true,
        context: 'organization',
        userId: query.userId ?? actorId,
        organizationId: query.organizationId,
        data,
      }
    }
    const actorId = await authorizeAccountPreferences(principal, usageLimitOperations.read)
    if (query.userId && query.userId !== actorId)
      throw new OrchestrationError('forbidden', "Cannot view other users' usage information")
    return {
      success: true,
      context: 'user',
      userId: actorId,
      organizationId: query.organizationId ?? null,
      data: await getUserUsageLimitInfo(actorId),
    }
  },
}

/** Updates a spending cap through existing plan/minimum/blocked-billing checks; never purchases a plan. */
export const updateUsageLimit: OperationUseCase<
  typeof usageLimitOperations.update,
  UsageLimitUpdateInput,
  UsageLimitResult
> = {
  operation: usageLimitOperations.update,
  async execute({ principal, input }) {
    const parsed = usageLimitUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        parsed.error.issues[0]?.message ?? 'Invalid usage limit request'
      )
    const command = parsed.data
    if (command.context === 'organization') {
      if (!command.organizationId)
        throw new OrchestrationError(
          'validation',
          'Organization ID is required when context is organization'
        )
      const actorId = await organizationActor(
        principal,
        usageLimitOperations.update,
        command.organizationId
      )
      const result = await updateOrganizationUsageLimit(command.organizationId, command.limit)
      if (!result.success)
        throw new OrchestrationError('validation', result.error ?? 'Failed to update usage limit')
      return {
        success: true,
        context: 'organization',
        userId: actorId,
        organizationId: command.organizationId,
        data: await loadOrganizationLimitData(principal, command.organizationId),
      }
    }
    const actorId = await authorizeAccountPreferences(principal, usageLimitOperations.update)
    const result = await updateUserUsageLimit(actorId, command.limit)
    if (!result.success)
      throw new OrchestrationError('validation', result.error ?? 'Failed to update usage limit')
    return {
      success: true,
      context: 'user',
      userId: actorId,
      organizationId: command.organizationId ?? null,
      data: await getUserUsageLimitInfo(actorId),
    }
  },
}
