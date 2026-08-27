import type { Principal } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'

export const CREDENTIAL_GROUP_DELEGATION_AUDIENCE = 'sim:credential-groups'

export interface CredentialGroupApplicationContext
  extends WorkspaceAuthorizationContext,
    CredentialGroupCredentialListContext {}

export const credentialGroupDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: CredentialGroupApplicationContext
  ) => principal.resourceScope?.credentialGroupId === context.credentialGroupId,
} satisfies WorkspaceDelegationPolicy<CredentialGroupApplicationContext>

export const credentialGroupWorkspaceDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (principal: Extract<Principal, { kind: 'delegated' }>) =>
    principal.resourceScope?.credentialGroupId === undefined,
} satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>
