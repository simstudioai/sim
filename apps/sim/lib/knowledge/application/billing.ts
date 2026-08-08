import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import {
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import type { KnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'

export class KnowledgeUsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeUsageLimitExceededError'
  }
}

export function resolveKnowledgeAttributedUserId(
  principal: Principal,
  context: KnowledgeWorkspaceContext
): string {
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: context.billedAccountUserId,
  }).attributedUserId
}

export function resolveKnowledgeBillingAttribution(
  principal: Principal,
  context: KnowledgeWorkspaceContext
): Promise<BillingAttributionSnapshot> {
  if (principal.kind === 'workspace_api_key') {
    return resolveSystemBillingAttribution(context.workspaceId)
  }
  return resolveBillingAttribution({
    actorUserId: resolveKnowledgeAttributedUserId(principal, context),
    workspaceId: context.workspaceId,
  })
}
