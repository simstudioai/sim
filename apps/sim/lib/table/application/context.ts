import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { TableAuthorizationContext } from '@/lib/table/application/authorization'
import { TABLE_NOT_FOUND_MESSAGE } from '@/lib/table/constants'
import { isTableIdShaped } from '@/lib/table/ids'
import { findActiveTablesByExactName, getTableById } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

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
 * workspace is reported as missing, never as forbidden — is written once. Within an asserted
 * workspace a table is also found by its name (`sim tables rows list leads`), which is unique
 * among the workspace's active tables; an id always wins, a reference shaped like an id is never
 * read as a name (a stale id costs no second query), and a name never reaches past the asserted
 * workspace. Every miss reads {@link TABLE_NOT_FOUND_MESSAGE}, as a refused authorization does.
 */
async function requireTable(tableId: string, workspaceId: string | undefined) {
  let table = await getTableById(tableId)
  if (!table && workspaceId !== undefined && !isTableIdShaped(tableId)) {
    const named = await findActiveTablesByExactName(workspaceId, tableId)
    if (named.length === 1) table = named[0]
  }
  if (!table || (workspaceId !== undefined && table.workspaceId !== workspaceId)) {
    throw new OrchestrationError('not_found', TABLE_NOT_FOUND_MESSAGE)
  }
  return table
}

/**
 * Loads the canonical context a table use case authorizes against.
 *
 * When the caller asserts a workspace, the workspace load no longer has to wait for the table
 * load: the asserted id is already in hand, so both round trips start together. What makes that
 * safe is that {@link requireTable} still compares the table's canonical `workspaceId` against
 * the assertion and reports any mismatch as `not_found`. The table outcome is inspected first and
 * unconditionally, so on every path that returns, the assertion has been *proven* equal to the
 * canonical workspace id — the context handed back is the table's own workspace, never a
 * workspace the caller merely named. A mismatch throws before the workspace outcome is read, so a
 * failing workspace load can never replace the concealing `not_found`. `Promise.allSettled` keeps
 * the branch that is thrown away from surfacing as an unhandled rejection. A final identity check
 * on the loaded context restates the invariant at the point of return, so the value handed back is
 * only ever a context whose own `workspaceId` is the table's.
 *
 * Without an asserted id there is nothing to start early — the table load is what reveals which
 * workspace to load — so that path stays sequential.
 */
export async function resolveActiveTableContext(input: {
  tableId: string
  assertedWorkspaceId?: string
}): Promise<ActiveTableContext> {
  const { tableId, assertedWorkspaceId } = input

  if (assertedWorkspaceId === undefined) {
    const table = await requireTable(tableId, undefined)
    const workspaceContext = await resolveTableWorkspaceContext(table.workspaceId)
    return { ...workspaceContext, tableId: table.id, table }
  }

  const [tableOutcome, workspaceOutcome] = await Promise.allSettled([
    requireTable(tableId, assertedWorkspaceId),
    resolveTableWorkspaceContext(assertedWorkspaceId),
  ])

  if (tableOutcome.status === 'rejected') throw tableOutcome.reason
  if (workspaceOutcome.status === 'rejected') throw workspaceOutcome.reason

  const table = tableOutcome.value
  const workspaceContext = workspaceOutcome.value
  if (workspaceContext.workspaceId !== table.workspaceId) {
    throw new OrchestrationError('not_found', TABLE_NOT_FOUND_MESSAGE)
  }
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

/**
 * Loads the canonical context an archived-table use case authorizes against.
 *
 * Restore is the one table operation whose subject is deliberately NOT active,
 * so it cannot go through {@link resolveActiveTableContext} — that resolver's
 * `getTableById` skips archived rows and would report every restorable table as
 * missing. The asserted-workspace comparison and its not-found concealment are
 * identical. It takes the id alone: archived tables' names need not be unique.
 */
export async function resolveArchivedTableContext(input: {
  tableId: string
  assertedWorkspaceId?: string
}): Promise<ActiveTableContext> {
  const table = await getTableById(input.tableId, { includeArchived: true })
  if (
    !table ||
    (input.assertedWorkspaceId !== undefined && table.workspaceId !== input.assertedWorkspaceId)
  ) {
    throw new OrchestrationError('not_found', TABLE_NOT_FOUND_MESSAGE)
  }
  const workspaceContext = await resolveTableWorkspaceContext(table.workspaceId)
  return { ...workspaceContext, tableId: table.id, table }
}
