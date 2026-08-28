import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ManagedOAuthCredentialApplicationContext } from '@/lib/credentials/managed-oauth'

export const CREDENTIAL_DELEGATION_AUDIENCE = 'sim:credentials'
export const MANAGED_OAUTH_DELEGATION_AUDIENCE = 'sim:managed-oauth-credentials'

export const credentialDelegationPolicy = {
  audience: CREDENTIAL_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>

export const managedOAuthCredentialDelegationPolicy = {
  audience: MANAGED_OAUTH_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: ManagedOAuthCredentialApplicationContext
  ) => principal.resourceScope?.credentialId === context.credentialId,
} satisfies WorkspaceDelegationPolicy<ManagedOAuthCredentialApplicationContext>

/**
 * Resolves the user whose credential grants an operation evaluates.
 *
 * `executionActorUserId` is the user the legacy internal route authenticated as.
 * Workspace authorization remains principal-based, and a principal subject
 * always takes precedence over this compatibility value.
 */
export function requireCredentialExecutionUserId(
  principal: Principal,
  executionActorUserId?: string
): string {
  const userId = resolvePrincipalSubjectUserId(principal) ?? executionActorUserId
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'Credential access requires a user subject or execution actor'
    )
  }
  return userId
}
