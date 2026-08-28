import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listCredentialProviderCatalog,
  type OAuthCredentialProviderCatalogEntry,
} from '@/lib/credentials/application/provider-catalog'
import { credentialProviderMatchesService } from '@/lib/oauth/utils'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface PrepareCredentialConnectionInput {
  workspaceId: string
  providerName: string
  credentialId?: string
  executionActorUserId?: string
}

export interface PrepareCredentialConnectionResult {
  providerId: string
  serviceName: string
  credentialId?: string
}

function resolveRequestedProvider(
  providers: readonly OAuthCredentialProviderCatalogEntry[],
  providerName: string
): OAuthCredentialProviderCatalogEntry {
  const requested = providerName.toLowerCase().trim()
  if (!requested) throw new OrchestrationError('validation', 'OAuth provider is required')

  const provider =
    providers.find((entry) =>
      entry.authorizationOptions.some((option) => option.providerId.toLowerCase() === requested)
    ) ??
    providers.find(
      (entry) =>
        entry.serviceId.toLowerCase() === requested || entry.name.toLowerCase() === requested
    ) ??
    providers.find(
      (entry) =>
        entry.name.toLowerCase().includes(requested) ||
        requested.includes(entry.name.toLowerCase()) ||
        entry.authorizationOptions.some(
          (option) =>
            option.providerId.toLowerCase().includes(requested) ||
            requested.includes(option.providerId.toLowerCase())
        )
    )

  if (!provider)
    throw new OrchestrationError('validation', `OAuth provider not found: ${providerName}`)
  if (!provider.available) {
    throw new OrchestrationError('conflict', `${provider.name} is not available in this workspace`)
  }
  return provider
}

export const prepareCredentialConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.prepareConnection,
  resolveContext: async ({ input }: { input: PrepareCredentialConnectionInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<PrepareCredentialConnectionResult> => {
    const providers = (await listCredentialProviderCatalog(principal, context)).filter(
      (entry): entry is OAuthCredentialProviderCatalogEntry => entry.type === 'oauth'
    )
    const requestedProvider = resolveRequestedProvider(providers, input.providerName)
    const requestedProviderId = requestedProvider.authorizationOptions[0]?.providerId
    if (!requestedProviderId) {
      throw new Error(`OAuth provider ${requestedProvider.serviceId} has no authorization option`)
    }

    if (!input.credentialId) {
      return {
        providerId: requestedProviderId,
        serviceName: requestedProvider.name,
      }
    }

    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      credentialId: input.credentialId,
      executionActorUserId: input.executionActorUserId,
    })
    if (
      !credentialProviderMatchesService(target.providerId, {
        providerId: requestedProviderId,
        additionalProviderIds: requestedProvider.authorizationOptions
          .slice(1)
          .map((option) => option.providerId),
      })
    ) {
      throw new OrchestrationError(
        'validation',
        `Credential belongs to provider ${target.providerId}, not ${requestedProviderId}`
      )
    }

    return {
      providerId: target.providerId,
      serviceName: requestedProvider.name,
      credentialId: target.credentialId,
    }
  },
})
