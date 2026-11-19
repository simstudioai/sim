import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listVisibleWorkspaceCredentials,
  listWorkspacePrincipalCredentials,
  type VisibleWorkspaceCredential,
} from '@/lib/credentials/queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
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

/** What a caller asks the visible workspace credentials for: a filter, an order and a page. */
type VisibleCredentialsQuery = Omit<ListWorkspaceCredentialsInput, 'workspaceId'> & {
  /** Only these credentials, of those visible. */
  ids?: readonly string[]
}

/**
 * One page of the workspace credentials `principal` may see: a workspace API key the shared
 * connections, a person what their workspace access and credential memberships show. Every use
 * case that acts on a credential the caller picked from the listing re-checks it here, so the
 * two never disagree.
 */
export async function listCredentialsVisibleTo(
  principal: Principal,
  workspaceId: string,
  query: VisibleCredentialsQuery
): Promise<ListWorkspaceCredentialsResult> {
  const types: Array<'oauth' | 'service_account'> = query.type
    ? [query.type]
    : ['oauth', 'service_account']
  const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder }

  if (principal.kind === 'workspace_api_key') {
    const page = await listWorkspacePrincipalCredentials({
      workspaceId,
      types,
      providerId: query.providerId,
      ...(query.ids ? { ids: query.ids } : {}),
      search: query.search,
      ...sort,
      limit: query.limit,
      cursorKeys: query.cursorKeys,
    })
    return { credentials: page.data, nextCursorKeys: page.nextCursorKeys }
  }

  const workspaceAccess = await checkWorkspaceAccess(
    workspaceId,
    requirePrincipalSubjectUserId(principal)
  )
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
    workspaceId,
    userId: requirePrincipalSubjectUserId(principal),
    workspaceAccess,
    types,
    providerId: query.providerId,
    ...(query.ids ? { ids: query.ids } : {}),
    search: query.search,
    ...sort,
    limit: query.limit,
    cursorKeys: query.cursorKeys,
  })
  return { credentials: page.data, nextCursorKeys: page.nextCursorKeys }
}

export const listWorkspaceCredentials = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listConnections,
  resolveContext: async ({ input }: { input: ListWorkspaceCredentialsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  execute: ({ principal, input, context }): Promise<ListWorkspaceCredentialsResult> =>
    listCredentialsVisibleTo(principal, context.workspaceId, input),
})
