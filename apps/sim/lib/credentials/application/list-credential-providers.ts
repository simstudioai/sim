import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  type CredentialProviderCatalogEntry,
  listCredentialProviderCatalog,
} from '@/lib/credentials/application/provider-catalog'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ListCredentialProvidersInput {
  workspaceId: string
  search?: string
}

export interface ListCredentialProvidersResult {
  providers: CredentialProviderCatalogEntry[]
}

export const listCredentialProviders = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listProviders,
  resolveContext: async ({ input }: { input: ListCredentialProvidersInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<ListCredentialProvidersResult> => {
    const search = input.search?.trim().toLowerCase()
    if (input.search !== undefined && !search) {
      throw new OrchestrationError('validation', 'search cannot be empty')
    }

    // A GitHub App installation is connected through Search integrations, never credential
    // creation, so it has no create fields and stays out of public discovery.
    const providers = (await listCredentialProviderCatalog(principal, context)).filter(
      (provider) =>
        provider.type !== 'service_account' ||
        provider.providerId !== GITHUB_INSTALLATION_PROVIDER_ID
    )
    return {
      providers: search
        ? providers.filter((provider) => provider.name.toLowerCase().includes(search))
        : providers,
    }
  },
})
