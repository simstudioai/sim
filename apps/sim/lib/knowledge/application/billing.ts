import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalExecutionActorUserId,
} from '@sim/auth/principal'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KnowledgeResourceContext } from '@/lib/knowledge/application/contexts'

export class KnowledgeUsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeUsageLimitExceededError'
  }
}

export function resolveKnowledgeAttributedUserId(
  principal: Principal,
  context: KnowledgeResourceContext
): string {
  const executionUserId = resolvePrincipalExecutionActorUserId(principal)
  if (executionUserId) return executionUserId
  if (context.workspaceId === undefined) {
    throw new OrchestrationError(
      'forbidden',
      'Knowledge operations require a user subject or execution actor'
    )
  }
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: context.billedAccountUserId,
  }).attributedUserId
}

export function resolveKnowledgeBillingAttribution(
  principal: Principal,
  context: KnowledgeResourceContext
): Promise<BillingAttributionSnapshot> {
  if (context.organizationId)
    return resolveOrganizationBillingAttribution({
      actorUserId: resolveKnowledgeAttributedUserId(principal, context),
      organizationId: context.organizationId,
    })
  if (context.workspaceId === undefined) {
    throw new Error('Legacy personal knowledge bases do not have workspace billing attribution')
  }
  if (principal.kind === 'workspace_api_key') {
    return resolveSystemBillingAttribution(context.workspaceId)
  }
  return resolveBillingAttribution({
    actorUserId: resolveKnowledgeAttributedUserId(principal, context),
    workspaceId: context.workspaceId,
  })
}

export async function resolveKnowledgeUsageAdmission(
  principal: Principal,
  context: KnowledgeResourceContext,
  resolveAttribution?: (workspaceId: string) => Promise<BillingAttributionSnapshot>
) {
  const userId = resolveKnowledgeAttributedUserId(principal, context)
  const billingAttribution = context.organizationId
    ? await resolveKnowledgeBillingAttribution(principal, context)
    : context.workspaceId
      ? resolveAttribution
        ? await resolveAttribution(context.workspaceId)
        : await resolveKnowledgeBillingAttribution(principal, context)
      : undefined
  const usage = billingAttribution
    ? await checkAttributedUsageLimits(billingAttribution)
    : await checkActorUsageLimits(userId)
  return { billingAttribution, usage, userId }
}
