import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  getPersonalOAuthCredentials,
  type PersonalOAuthCredential,
} from '@/lib/credentials/personal'
import {
  getPersonalTokenCredentials,
  type PersonalTokenCredential,
} from '@/lib/credentials/personal-tokens'
import { providerIdsForService } from '@/lib/oauth/utils'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

async function resolveContext({ input }: { input: { workspaceId: string } }) {
  const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

export const listPersonalCredentials = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listPersonal,
  resolveContext,
  authorizationOptions: { delegation: credentialDelegationPolicy },
  async execute({ principal, context }): Promise<{
    credentials: (PersonalOAuthCredential | PersonalTokenCredential)[]
  }> {
    const userId = requirePrincipalSubjectUserId(principal)
    const [oauthCredentials, tokenCredentials] = await Promise.all([
      getPersonalOAuthCredentials(context.workspaceId, userId),
      getPersonalTokenCredentials(context.workspaceId, userId),
    ])
    return {
      credentials: [...oauthCredentials, ...tokenCredentials],
    }
  },
})

export interface AuthorizePersonalCredentialInput {
  workspaceId: string
  credentialId: string
  expectedProviderId: string
}

/** Rechecked at token use, including after approval and resume; workspace admins get no override. */
export const authorizePersonalCredential = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.authorizePersonal,
  resolveContext: ({ input }: { input: AuthorizePersonalCredentialInput }) =>
    resolveContext({ input }),
  authorizationOptions: { delegation: credentialDelegationPolicy },
  async execute({ principal, context, input }): Promise<PersonalOAuthCredential> {
    const credentials = await getPersonalOAuthCredentials(
      context.workspaceId,
      requirePrincipalSubjectUserId(principal),
      input.credentialId
    )
    const providerIds = providerIdsForService(input.expectedProviderId)
    const credential = credentials.find(
      (entry) => entry.id === input.credentialId && providerIds.includes(entry.providerId)
    )
    if (!credential) {
      throw new OrchestrationError(
        'forbidden',
        'Assistant can only use your own connected account for this integration. Connect your account and try again.'
      )
    }
    return credential
  },
})
