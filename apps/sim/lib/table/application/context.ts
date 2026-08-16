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

/**
 * Loads a table and asserts it lives in `workspaceId` when the caller named one.
 *
 * Shared by both resolvers below so the not-found concealment — a table outside the asserted
 * workspace is reported as missing, never as forbidden — is written once.
 */
async function requireTable(tableId: string, workspaceId: string | undefined) {
  const table = await getTableById(tableId)
  if (!table || (workspaceId !== undefined && table.workspaceId !== workspaceId)) {
    throw new OrchestrationError('not_found', 'Table not found')
  }
  return table
}

export async function resolveActiveTableContext(input: {
  tableId: string
  assertedWorkspaceId?: string
}): Promise<ActiveTableContext> {
  const table = await requireTable(input.tableId, input.assertedWorkspaceId)
  const workspaceContext = await resolveTableWorkspaceContext(table.workspaceId)
  return { ...workspaceContext, tableId: table.id, table }
}

/**
 * Resolves one table against a workspace context the caller already loaded.
 *
 * Same result as {@link resolveActiveTableContext}, minus its workspace load. A batch has that
 * context in hand before the first item — it is what bounded and authorized the request — and it
 * cannot differ per item, so re-resolving it once per table is a whole extra query each.
 */
export async function resolveActiveTableInWorkspace(
  tableId: string,
  workspaceContext: TableWorkspaceContext
): Promise<ActiveTableContext> {
  const table = await requireTable(tableId, workspaceContext.workspaceId)
  return { ...workspaceContext, tableId: table.id, table }
}
