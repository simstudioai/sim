import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireCredentialGroupEnrollmentAccess } from '@/lib/credential-groups/application/authorization'
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
  resolveContext: async ({ input }: { input: ResolveManagedOAuthTokenInput }) => {
    const context = await loadManagedOAuthCredentialApplicationContext(input.credentialId)
    if (!context) throw new OrchestrationError('not_found', 'Managed credential not found')
    return context
  },
  authorizationOptions: { delegation: managedOAuthCredentialDelegationPolicy },
  async authorizeResource({ principal, context }) {
    const access = await requireCredentialGroupEnrollmentAccess(
      principal,
      context.credentialGroupId
    )
    if (access.enrollmentId !== context.credentialGroupEnrollmentId) {
      throw new OrchestrationError('forbidden', 'Credential Group enrollment access required')
    }
  },
  execute: async ({ input, context }): Promise<ResolvedManagedOAuthToken> =>
    resolveManagedOAuthToken({
      credentialId: context.credentialId,
      workspaceId: context.workspaceId,
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
