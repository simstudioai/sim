import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type CredentialActorContext, getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import type { QuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface SaveCredentialDraftInput {
  workspaceId: string
  providerId: string
  displayName: string
  description?: string
  credentialId?: string
  oauthClientConfig?: QuickBooksOAuthClientConfig
}

interface SaveCredentialDraftContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
  credentialAccess?: CredentialActorContext
}

export const saveCredentialDraft = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.saveDraft,
  async resolveContext({
    input,
  }: {
    input: SaveCredentialDraftInput
  }): Promise<SaveCredentialDraftContext> {
    const workspace = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return workspace
  },
  authorizationOptions: {},
  async authorizeResource({ principal, input, context }) {
    if (!input.credentialId) return
    context.credentialAccess = await getCredentialActorContext(
      input.credentialId,
      requirePrincipalSubjectUserId(principal)
    )
    if (
      !context.credentialAccess?.credential ||
      context.credentialAccess.credential.type === 'managed_oauth' ||
      context.credentialAccess.credential.workspaceId !== context.workspaceId ||
      !context.credentialAccess.isAdmin
    ) {
      throw new ForbiddenOperationError(
        'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
        'Admin access required on the target credential'
      )
    }
  },
  async execute({ principal, input }) {
    const draft = await createConnectDraft({
      userId: requirePrincipalSubjectUserId(principal),
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      displayName: input.displayName,
      description: input.description,
      credentialId: input.credentialId,
      oauthClientConfig: input.oauthClientConfig,
    })
    return { success: true as const, draftId: draft.id }
  },
})
