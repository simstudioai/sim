import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  type CredentialProviderCatalogEntry,
  listCredentialProviderCatalog,
} from '@/lib/credentials/application/provider-catalog'
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

    const providers = await listCredentialProviderCatalog(principal, context)
    return {
      providers: search
        ? providers.filter((provider) => provider.name.toLowerCase().includes(search))
        : providers,
    }
  },
})
