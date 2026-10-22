import type { Principal } from '@sim/auth/principal'
import { principalWorkspaceId, workspaceDelegationRestrictions } from '@sim/auth/principal'
import {
  authorizeWorkspaceOperation,
  type WorkspaceAuthorizationContext,
  type WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { isCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
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
    if (
      isCopilotWorkspaceInvocation(principal) &&
      principalWorkspaceId(principal) === context.workspaceId &&
      workspaceDelegationRestrictions(principal)?.tableId === undefined
    )
      return true
    return context.tableId === undefined
      ? workspaceDelegationRestrictions(principal)?.tableId === undefined
      : workspaceDelegationRestrictions(principal)?.tableId === context.tableId
  },
}

export function authorizeTableOperation(
  principal: Principal,
  operation: TableOperation,
  context: TableAuthorizationContext
) {
  return authorizeWorkspaceOperation(principal, operation, context, {
    delegation: tableDelegationPolicy,
  })
}
