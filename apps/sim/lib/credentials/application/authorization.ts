import type { Principal } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
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
