import type { Principal } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import type { ManagedOAuthCredentialApplicationContext } from '@/lib/credentials/managed-oauth'

export const MANAGED_OAUTH_DELEGATION_AUDIENCE = 'sim:managed-oauth-credentials'

export const managedOAuthCredentialDelegationPolicy = {
  audience: MANAGED_OAUTH_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: ManagedOAuthCredentialApplicationContext
  ) => principal.resourceScope?.credentialId === context.credentialId,
} satisfies WorkspaceDelegationPolicy<ManagedOAuthCredentialApplicationContext>
