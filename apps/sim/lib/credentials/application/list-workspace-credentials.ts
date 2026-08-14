import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
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
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}

export interface ListWorkspaceCredentialsResult {
  credentials: VisibleWorkspaceCredential[]
  nextCursorKeys: CursorKey[] | null
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
    const sort = { sortBy: input.sortBy, sortOrder: input.sortOrder }

    if (principal.kind === 'workspace_api_key') {
      const page = await listWorkspacePrincipalCredentials({
        workspaceId: context.workspaceId,
        types,
        providerId: input.providerId,
        search: input.search,
        ...sort,
        limit: input.limit,
        cursorKeys: input.cursorKeys,
      })
      return { credentials: page.data, nextCursorKeys: page.nextCursorKeys }
    }

    const workspaceAccess = await checkWorkspaceAccess(context.workspaceId, principal.userId)
    if (!workspaceAccess.hasAccess) {
      /**
       * `hasAccess` is `permission !== null` — the same condition
       * `requirePermission` classifies as no reach into the workspace at all —
       * so it raises the canonical error rather than a bare `forbidden`. It
       * stays codeless deliberately: this is the concealed cross-tenant class,
       * not one a caller can act on.
       */
      throw new NoWorkspaceAccessError()
    }
    const page = await listVisibleWorkspaceCredentials({
      workspaceId: context.workspaceId,
      userId: principal.userId,
      workspaceAccess,
      types,
      providerId: input.providerId,
      search: input.search,
      ...sort,
      limit: input.limit,
      cursorKeys: input.cursorKeys,
    })
    return { credentials: page.data, nextCursorKeys: page.nextCursorKeys }
  },
})
