import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  type CredentialProviderCatalogEntry,
  listCredentialProviderCatalog,
} from '@/lib/credentials/application/provider-catalog'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ListCredentialProvidersInput {
  workspaceId: string
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
  authorizationOptions: {},
  execute: async ({ principal, context }): Promise<ListCredentialProvidersResult> => ({
    providers: await listCredentialProviderCatalog(principal, context),
  }),
})
