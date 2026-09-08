import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'
import { managedOAuthCredentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  loadManagedOAuthCredentialApplicationContext,
  type ResolvedManagedOAuthToken,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'

export interface ResolveManagedOAuthTokenInput {
  credentialId: string
  expectedProviderId: string
  requiredScopes: string[]
  toolId: string
}

export const resolveManagedOAuthCredentialToken = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.useManagedOAuth,
  resolveContext: async ({
    input,
    principal,
  }: {
    input: ResolveManagedOAuthTokenInput
    principal: Principal
  }) => {
    if (principal.kind !== 'delegated')
      throw new OrchestrationError('forbidden', 'Managed credentials require delegated execution')
    const context = await loadManagedOAuthCredentialApplicationContext(
      input.credentialId,
      principal.workspaceId
    )
    if (!context) throw new OrchestrationError('not_found', 'Managed credential not found')
    return context
  },
  authorizationOptions: { delegation: managedOAuthCredentialDelegationPolicy },
  async authorizeResource({ principal, context, resourcePolicy }) {
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  execute: async ({ input, context }): Promise<ResolvedManagedOAuthToken> =>
    resolveManagedOAuthToken({
      credentialId: context.credentialId,
      ...(context.organizationId
        ? { organizationId: context.organizationId }
        : { workspaceId: context.workspaceId }),
      expectedProviderId: input.expectedProviderId,
      requiredScopes: input.requiredScopes,
    }),
  projectAudit({ input, context }) {
    return {
      action: AuditAction.CREDENTIAL_ACCESSED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: context.credentialId,
      description: `Accessed managed OAuth credential for provider ${input.expectedProviderId}`,
      metadata: {
        provider: input.expectedProviderId,
        credentialType: 'managed_oauth',
        toolId: input.toolId,
      },
    }
  },
})
