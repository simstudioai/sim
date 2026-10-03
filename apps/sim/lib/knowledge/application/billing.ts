import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalExecutionActorUserId,
} from '@sim/auth/principal'
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
    throw new Error('Knowledge base billing requires a workspace or organization')
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
  const billingAttribution =
    resolveAttribution && context.workspaceId
      ? await resolveAttribution(context.workspaceId)
      : await resolveKnowledgeBillingAttribution(principal, context)
  const usage = await checkAttributedUsageLimits(billingAttribution)
  return { billingAttribution, usage, userId }
}
