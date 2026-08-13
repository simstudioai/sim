import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type CreateCredentialConnectionInput = {
  workspaceId: string
} & (
  | { providerId: string; displayName: string; credentialId?: never }
  | { credentialId: string; providerId?: never; displayName?: never }
)

export interface CreateCredentialConnectionResult {
  authorizationUrl: string
  expiresAt: Date
}

export const createCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.createConnection,
  resolveContext: async ({ input }: { input: CreateCredentialConnectionInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<CreateCredentialConnectionResult> => {
    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      providerId: input.providerId,
      credentialId: input.credentialId,
    })
    const displayName = input.providerId ? input.displayName : target.displayName
    if (!displayName) throw new Error('Resolved credential connection target has no display name')

    const draft = await createConnectDraft({
      userId: principal.userId,
      workspaceId: context.workspaceId,
      providerId: target.providerId,
      credentialId: target.credentialId,
      displayName,
    })
    const authorizationUrl = new URL('/api/auth/oauth2/authorize', getBaseUrl())
    authorizationUrl.searchParams.set('draftId', draft.id)
    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: draft.expiresAt,
    }
  },
})
