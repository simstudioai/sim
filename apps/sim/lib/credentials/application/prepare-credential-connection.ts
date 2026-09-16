import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listCredentialProviderCatalog,
  type OAuthCredentialProviderCatalogEntry,
} from '@/lib/credentials/application/provider-catalog'
import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'
import { getPersonalTokenCredentials } from '@/lib/credentials/personal-tokens'
import { isServiceAccountProviderId } from '@/lib/credentials/service-account-provider-ids'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import { allowedIntegrationTypes } from '@/lib/integrations/principal-scope.server'
import { credentialProviderMatchesService } from '@/lib/oauth/utils'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface PrepareCredentialConnectionInput {
  workspaceId: string
  providerName: string
  credentialId?: string
  personalOnly?: boolean
}

export interface PrepareCredentialConnectionResult {
  kind: 'oauth' | 'managed_oauth' | 'personal_token'
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
    if (
      input.personalOnly &&
      isServiceAccountProviderId(
        input.providerName
          .toLowerCase()
          .trim()
          .replace(/[\s_]+/g, '-')
      )
    ) {
      throw new OrchestrationError(
        'validation',
        'Connect your own account to use this integration.'
      )
    }
    if (input.personalOnly && input.providerName.toLowerCase().trim() === 'gitlab') {
      const userId = requirePrincipalSubjectUserId(principal)
      const [allowedIntegrations, blockVisibility] = await Promise.all([
        allowedIntegrationTypes(principal, context.workspaceId),
        getBlockVisibility({
          userId,
          ...(context.workspaceOrganizationId ? { orgId: context.workspaceOrganizationId } : {}),
        }),
      ])
      const visibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: allowedIntegrations,
        blockVisibility,
      })
      if (!visibility.isCredentialVisible({ providerId: 'gitlab', type: 'personal_token' })) {
        throw new OrchestrationError('conflict', 'GitLab is not available in this workspace')
      }
      if (input.credentialId) {
        const personalCredentials = await getPersonalTokenCredentials(
          context.workspaceId,
          userId,
          input.credentialId
        )
        if (
          !personalCredentials.some(
            (entry) => entry.id === input.credentialId && entry.providerId === 'gitlab'
          )
        ) {
          throw new OrchestrationError(
            'forbidden',
            'Assistant can only reconnect your own GitLab account.'
          )
        }
      }
      return { kind: 'personal_token', providerId: 'gitlab', serviceName: 'GitLab' }
    }
    const providers = (
      await listCredentialProviderCatalog(
        principal,
        context,
        input.personalOnly ? 'managed_oauth' : 'oauth'
      )
    ).filter((entry): entry is OAuthCredentialProviderCatalogEntry => entry.type === 'oauth')
    const requestedProvider = resolveRequestedProvider(providers, input.providerName)
    const requestedProviderId = requestedProvider.authorizationOptions[0]?.providerId
    if (!requestedProviderId) {
      throw new Error(`OAuth provider ${requestedProvider.serviceId} has no authorization option`)
    }

    if (input.personalOnly) {
      const personalCredential = input.credentialId
        ? (
            await getPersonalOAuthCredentials(
              context.workspaceId,
              requirePrincipalSubjectUserId(principal),
              input.credentialId
            )
          ).find((entry) => entry.id === input.credentialId)
        : undefined
      if (input.credentialId && !personalCredential) {
        throw new OrchestrationError(
          'forbidden',
          'Assistant can only reconnect your own account. Connect your account and try again.'
        )
      }
      if (
        personalCredential &&
        !requestedProvider.authorizationOptions.some(
          (option) => option.providerId === personalCredential.providerId
        )
      ) {
        throw new OrchestrationError(
          'validation',
          'Credential provider does not match the requested integration'
        )
      }
      if (!findCredentialGroupProviderFromProviderId(requestedProviderId)) {
        throw new OrchestrationError(
          'validation',
          'This integration cannot be connected through Connected accounts'
        )
      }
      return {
        kind: 'managed_oauth',
        providerId: personalCredential?.providerId ?? requestedProviderId,
        serviceName: requestedProvider.name,
      }
    }

    if (!input.credentialId) {
      return {
        kind: 'oauth',
        providerId: requestedProviderId,
        serviceName: requestedProvider.name,
      }
    }

    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      credentialId: input.credentialId,
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
      kind: 'oauth',
      providerId: target.providerId,
      serviceName: requestedProvider.name,
      credentialId: target.credentialId,
    }
  },
})
