import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const CUSTOM_TOOL_DELEGATION_AUDIENCE = 'sim:custom-tools'

export const customToolDelegationPolicy = {
  audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>

/**
 * Resolves the user whose custom-tool library an operation reads or mutates.
 *
 * Actorless execution keeps the pre-application-boundary behavior by falling
 * back to `ExecutionContext.userId`, the user the legacy internal route ran as.
 * A real principal subject always wins, so the fallback is not an impersonation
 * input and is never involved in workspace authorization.
 */
export function requireCustomToolUserId(
  principal: Principal,
  executionActorUserId?: string
): string {
  const userId = resolvePrincipalSubjectUserId(principal) ?? executionActorUserId
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'Custom tools are resolved from a user library, and this run has no execution actor'
    )
  }
  return userId
}
