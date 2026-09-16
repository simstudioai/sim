import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { defineAuthorizedCredentialUseCase } from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { decryptPersonalToken } from '@/lib/credentials/gitlab-personal-token'
import { requirePersonalTokenEnrollment } from '@/lib/credentials/personal-tokens'

export interface ResolvePersonalTokenInput {
  credentialId: string
  assertedWorkspaceId: string
  expectedProviderId: string
}

/** Reauthorizes the owner on every use; callers never substitute an admin or token creator. */
export const resolvePersonalToken = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.resolvePersonalToken,
  resolveContext: ({ input }: { input: ResolvePersonalTokenInput }) =>
    resolveCredentialApplicationContext(input),
  async execute({ principal, input, context }) {
    const current = context.credential
    /**
     * actorless-unsupported: Personal tokens belong to the acting person; this operation excludes executor and workspace-key principals.
     */
    const userId = requirePrincipalSubjectUserId(principal)
    if (
      current.type !== 'personal_token' ||
      current.createdBy !== userId ||
      current.providerId !== input.expectedProviderId ||
      current.providerId !== 'gitlab' ||
      !current.providerSubjectId ||
      !current.providerTenantId ||
      !current.encryptedPersonalToken ||
      current.revokedAt ||
      (current.accessTokenExpiresAt && current.accessTokenExpiresAt <= new Date())
    ) {
      throw new OrchestrationError(
        'forbidden',
        'Connect your own active personal token for this integration'
      )
    }
    await requirePersonalTokenEnrollment({
      ...resourceScopeFields(resourceScopeFromOwner(current)),
      userId,
      enrollmentId: current.credentialGroupEnrollmentId,
    })
    const accessToken = await decryptPersonalToken(current.encryptedPersonalToken, {
      providerId: 'gitlab',
      ownerUserId: userId,
      ...resourceScopeFields(resourceScopeFromOwner(current)),
      subjectId: current.providerSubjectId,
      instanceUrl: current.providerTenantId,
    })
    return { accessToken, instanceUrl: current.providerTenantId, providerId: current.providerId }
  },
  projectAudit({ context }) {
    return {
      action: AuditAction.CREDENTIAL_ACCESSED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: context.credential.id,
      description: 'Used personal GitLab token',
      metadata: {
        credentialType: 'personal_token',
        provider: 'gitlab',
        instanceUrl: context.credential.providerTenantId,
      },
    }
  },
})
