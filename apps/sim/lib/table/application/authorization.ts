import type { Principal } from '@sim/auth/principal'
import {
  authorizeWorkspaceOperation,
  type WorkspaceAuthorizationContext,
  type WorkspaceAuthorizationOptions,
  type WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import type { TableOperation } from '@/lib/table/application/operations'

export const TABLE_DELEGATION_AUDIENCE = 'sim:tables'

export interface TableAuthorizationContext extends WorkspaceAuthorizationContext {
  tableId?: string
  rowId?: string
  viewId?: string
  groupId?: string
  importId?: string
  exportId?: string
  billedAccountUserId: string
}

export const tableDelegationPolicy: WorkspaceDelegationPolicy<TableAuthorizationContext> = {
  audience: TABLE_DELEGATION_AUDIENCE,
  isWithinScope(
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: TableAuthorizationContext
  ) {
    return context.tableId === undefined
      ? principal.resourceScope?.tableId === undefined
      : principal.resourceScope?.tableId === context.tableId
  },
}

/** Everything {@link authorizeWorkspaceOperation} takes except the delegation policy, which is
 *  fixed for this domain. */
export type TableAuthorizationOptions = Omit<
  WorkspaceAuthorizationOptions<TableAuthorizationContext>,
  'delegation'
>

export function authorizeTableOperation(
  principal: Principal,
  operation: TableOperation,
  context: TableAuthorizationContext,
  options?: TableAuthorizationOptions
) {
  return authorizeWorkspaceOperation(principal, operation, context, {
    ...options,
    delegation: tableDelegationPolicy,
  })
}
