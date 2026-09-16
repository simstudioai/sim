import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceScope,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { canUseCredential, getCredentialActorContext } from '@/lib/credentials/access'
import { authorizeOrganizationCredentialUse } from '@/lib/credentials/application/organization-credentials'
import type { CredentialRow } from '@/lib/credentials/queries'

/** Resolves source credentials using the authorization policy of their canonical owner scope. */
export async function requireConnectorCredential(input: {
  principal: Principal
  credentialId: string
  scope: ResourceScope
  actingUserId: string
  requestId: string
}): Promise<CredentialRow> {
  if (input.scope.kind === 'organization') {
    const { credential } = await authorizeOrganizationCredentialUse({
      principal: input.principal,
      organizationId: input.scope.organizationId,
      credentialId: input.credentialId,
      requestId: input.requestId,
    })
    return credential
  }

  const access = await getCredentialActorContext(input.credentialId, input.actingUserId)
  if (
    !access.credential ||
    !sameResourceScope(resourceScopeFromOwner(access.credential), input.scope) ||
    !canUseCredential(access)
  ) {
    throw new OrchestrationError(
      'validation',
      'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.'
    )
  }
  return access.credential
}
