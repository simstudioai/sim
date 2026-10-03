import { type Principal, resolvePrincipalExecutionActorUserId } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ManagedMcpCredentialApplicationContext } from '@/lib/credentials/managed-mcp'
import type { ManagedOAuthCredentialApplicationContext } from '@/lib/credentials/managed-oauth'

export const CREDENTIAL_DELEGATION_AUDIENCE = 'sim:credentials'
export const MANAGED_OAUTH_DELEGATION_AUDIENCE = 'sim:managed-oauth-credentials'
export const MANAGED_MCP_DELEGATION_AUDIENCE = 'sim:managed-mcp-credentials'

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

export const managedMcpCredentialDelegationPolicy = {
  audience: MANAGED_MCP_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: ManagedMcpCredentialApplicationContext
  ) => principal.resourceScope?.credentialId === context.credentialId,
} satisfies WorkspaceDelegationPolicy<ManagedMcpCredentialApplicationContext>

/**
 * Resolves the user whose credential grants an operation evaluates.
 *
 * Actorless execution uses only the compatibility actor bound into the executor
 * principal by the trusted runtime. Workspace authorization remains
 * principal-based, and a principal subject always takes precedence.
 */
export function requireCredentialExecutionUserId(principal: Principal): string {
  const userId = resolvePrincipalExecutionActorUserId(principal)
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'Credential access requires a user subject or execution actor'
    )
  }
  return userId
}
