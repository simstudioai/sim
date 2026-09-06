import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { StartPersonalCredentialConnectionBody } from '@/lib/api/contracts/credentials'
import {
  defineAuthorizedWorkspaceUseCase,
  InsufficientWorkspacePermissionsError,
  requireCurrentHumanRole,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadWorkspaceAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { getCredentialGroupOAuthContextForEnrollment } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import {
  findCredentialGroupProviderFromProviderId,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Connects the authenticated person through the workspace's canonical account enrollment. */
export const startPersonalCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.startPersonalConnection,
  resolveContext: async ({ input }: { input: StartPersonalCredentialConnectionBody }) => {
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
    let group = await loadWorkspaceAccountsCredentialListContext(context.workspaceId)
    if (!group || !group.options.some((option) => option.provider === provider)) {
      try {
        await requireCurrentHumanRole(userId, context, 'admin')
      } catch (error) {
        if (!(error instanceof InsufficientWorkspacePermissionsError)) throw error
        throw new OrchestrationError(
          'forbidden',
          `Ask a workspace admin to enable ${service.name} in Connected accounts`
        )
      }
      if (!isCredentialGroupStandardOAuthProvider(provider)) {
        throw new OrchestrationError(
          'validation',
          'Configure Slack sign-in in Connected accounts first'
        )
      }
      await ensureWorkspaceAccountsGroup(context.workspaceId, userId, {
        provider,
        label: service.name,
        required: false,
      })
      group = await loadWorkspaceAccountsCredentialListContext(context.workspaceId)
    }
    if (group?.status !== 'active') {
      throw new OrchestrationError('forbidden', 'Connected accounts is disabled in this workspace')
    }
    const options = group.options.filter((option) => option.provider === provider)
    if (options.length !== 1 || options[0]?.status !== 'active') {
      throw new OrchestrationError(
        'conflict',
        `Ask a workspace admin to enable ${service.name} in Connected accounts`
      )
    }
    const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment({
      workspaceId: context.workspaceId,
      credentialGroupId: group.credentialGroupId,
      userId,
    })
    const token = new URL(invitationLink).pathname.split('/').at(-1)
    if (!token) throw new Error('Account enrollment did not return an invitation token')
    const oauth = await getCredentialGroupOAuthContextForEnrollment(
      {
        workspaceId: context.workspaceId,
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
