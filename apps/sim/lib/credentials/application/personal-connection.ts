import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCredentialGroupOAuthContextForEnrollment } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'
import { requireWorkspacePersonalAccounts } from '@/lib/credentials/application/workspace-personal-accounts'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface StartPersonalCredentialConnectionInput {
  workspaceId: string
  providerId: string
  credentialId?: string
}

/** Connects the authenticated person through the workspace's organization account enrollment. */
export const startPersonalCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.startPersonalConnection,
  resolveContext: async ({ input }: { input: StartPersonalCredentialConnectionInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const provider = findCredentialGroupProviderFromProviderId(input.providerId)
    const catalog = await listCredentialProviderCatalog(principal, context, 'managed_oauth')
    const service = catalog.find(
      (entry) =>
        entry.type === 'oauth' &&
        entry.available &&
        entry.authorizationOptions.some((option) => option.providerId === input.providerId)
    )
    if (!provider || !service) {
      throw new OrchestrationError('validation', 'This integration cannot be connected here')
    }
    const group = await requireWorkspacePersonalAccounts(principal, context)
    if (input.credentialId) {
      const credentials = await getPersonalOAuthCredentials(
        context.workspaceId,
        userId,
        input.credentialId
      )
      if (
        !credentials.some(
          (entry) => entry.id === input.credentialId && entry.providerId === input.providerId
        )
      ) {
        throw new OrchestrationError('forbidden', 'You can only reconnect your own account')
      }
    }
    const options = group.options.filter((option) => option.provider === provider)
    if (options.length !== 1 || options[0]?.status !== 'active') {
      throw new OrchestrationError(
        'conflict',
        `Ask an organization admin to enable ${service.name} in organization settings`
      )
    }
    const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment({
      organizationId: group.organizationId,
      credentialGroupId: group.credentialGroupId,
      userId,
    })
    const token = new URL(invitationLink).pathname.split('/').at(-1)
    if (!token) throw new Error('Account enrollment did not return an invitation token')
    const oauth = await getCredentialGroupOAuthContextForEnrollment(
      {
        organizationId: group.organizationId,
        credentialGroupId: group.credentialGroupId,
        enrollmentId: enrollment.id,
        email: enrollment.email,
      },
      options[0].id
    )
    if (!oauth)
      throw new OrchestrationError('forbidden', 'This account connection is no longer available')
    return {
      url: await startCredentialGroupOAuth(oauth, token, { completionRedirect: true }),
      providerId: input.providerId,
    }
  },
})
