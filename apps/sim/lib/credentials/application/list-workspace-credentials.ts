import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listVisibleWorkspaceCredentials,
  listWorkspacePrincipalCredentials,
  type VisibleWorkspaceCredential,
} from '@/lib/credentials/queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export interface ListWorkspaceCredentialsInput {
  workspaceId: string
  type?: 'oauth' | 'service_account'
  providerId?: string
  search?: string
  sortBy: 'displayName' | 'createdAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
}

export interface ListWorkspaceCredentialsResult {
  credentials: VisibleWorkspaceCredential[]
}

export const listWorkspaceCredentials = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listConnections,
  resolveContext: async ({ input }: { input: ListWorkspaceCredentialsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ListWorkspaceCredentialsResult> => {
    const types: Array<'oauth' | 'service_account'> = input.type
      ? [input.type]
      : ['oauth', 'service_account']
    if (principal.kind === 'workspace_api_key') {
      return {
        credentials: await listWorkspacePrincipalCredentials({
          workspaceId: context.workspaceId,
          types,
          providerId: input.providerId,
          search: input.search,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        }),
      }
    }

    const workspaceAccess = await checkWorkspaceAccess(context.workspaceId, principal.userId)
    if (!workspaceAccess.hasAccess) {
      throw new OrchestrationError('forbidden', 'Access denied')
    }
    return {
      credentials: await listVisibleWorkspaceCredentials({
        workspaceId: context.workspaceId,
        userId: principal.userId,
        workspaceAccess,
        types,
        providerId: input.providerId,
        search: input.search,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }),
    }
  },
})
