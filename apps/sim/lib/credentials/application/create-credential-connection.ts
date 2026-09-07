import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import type { QuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type CreateCredentialConnectionInput = {
  workspaceId: string
  oauthClientConfig?: QuickBooksOAuthClientConfig
} & (
  | { providerId: string; displayName?: string; credentialId?: never }
  | {
      credentialId: string
      assertedProviderId?: string
      providerId?: never
      displayName?: never
    }
)

export interface CreateCredentialConnectionResult {
  authorizationUrl: string
  draftId: string
  expiresAt: Date
  providerId: string
  workspaceId: string
  credentialId?: string
}

export const createCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.createConnection,
  resolveContext: async ({ input }: { input: CreateCredentialConnectionInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<CreateCredentialConnectionResult> => {
    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      providerId: input.providerId,
      credentialId: input.credentialId,
      assertedProviderId: 'assertedProviderId' in input ? input.assertedProviderId : undefined,
    })
    if (target.providerId === 'quickbooks' && !input.oauthClientConfig) {
      throw new OrchestrationError(
        'validation',
        'QuickBooks OAuth client configuration is required'
      )
    }
    if (target.providerId !== 'quickbooks' && input.oauthClientConfig) {
      throw new OrchestrationError(
        'validation',
        'OAuth client configuration is only supported for QuickBooks'
      )
    }
    const displayName = input.providerId ? input.displayName : target.displayName

    const draft = await createConnectDraft({
      userId: requirePrincipalSubjectUserId(principal),
      workspaceId: context.workspaceId,
      providerId: target.providerId,
      credentialId: target.credentialId,
      displayName,
      oauthClientConfig: input.oauthClientConfig,
    })
    const authorizationUrl = new URL('/api/auth/oauth2/authorize', getBaseUrl())
    authorizationUrl.searchParams.set('draftId', draft.id)
    return {
      authorizationUrl: authorizationUrl.toString(),
      draftId: draft.id,
      expiresAt: draft.expiresAt,
      providerId: target.providerId,
      workspaceId: context.workspaceId,
      ...(target.credentialId ? { credentialId: target.credentialId } : {}),
    }
  },
})
