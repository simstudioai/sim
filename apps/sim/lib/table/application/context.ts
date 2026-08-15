import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getTableById, type TableDefinition } from '@/lib/table'
import type { TableAuthorizationContext } from '@/lib/table/application/authorization'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type TableWorkspaceContext = TableAuthorizationContext

export interface ActiveTableContext extends TableWorkspaceContext {
  tableId: string
  table: TableDefinition
}

export async function resolveTableWorkspaceContext(
  workspaceId: string
): Promise<TableWorkspaceContext> {
  const canonical = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!canonical) throw new OrchestrationError('not_found', 'Workspace not found')
  return canonical
}

export async function resolveActiveTableContext(input: {
  tableId: string
  assertedWorkspaceId?: string
}): Promise<ActiveTableContext> {
  const table = await getTableById(input.tableId)
  if (
    !table ||
    (input.assertedWorkspaceId !== undefined && table.workspaceId !== input.assertedWorkspaceId)
  ) {
    // One message for "no such table" and "table in another workspace" so
    // existence never leaks across workspaces — but actionable either way.
    throw new OrchestrationError(
      'not_found',
      `Table "${input.tableId}" not found in this workspace — it may not exist or may belong to a different workspace. Run glob("tables/*") to list the tables you can use here.`
    )
  }
  const workspaceContext = await resolveTableWorkspaceContext(table.workspaceId)
  return { ...workspaceContext, tableId: table.id, table }
}
