import { listTables, type TableScope } from '@/lib/table/service'
import type { TableDefinition, TableSchema } from '@/lib/table/types'
import { normalizeColumn } from '@/app/api/table/utils'

/** Serializes a stored date to the ISO string the wire carries. */
function toWireDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * Lists a workspace's tables in the wire shape `GET /api/table` returns.
 *
 * Shared by that route and the Tables page's server prefetch so a hydrated cache entry and a
 * client fetch cannot disagree. The shaping is not incidental: the route drops `metadata`,
 * runs every column through {@link normalizeColumn}, serializes the three dates, and defaults
 * the job fields — so caching raw `listTables` rows would hydrate un-normalized columns and a
 * field the client never sees, then swap them out on the first refetch.
 */
export async function listTablesForWorkspace(
  workspaceId: string,
  scope: TableScope = 'active'
): Promise<TableDefinition[]> {
  const tables = await listTables(workspaceId, { scope })

  return tables.map((table) => ({
    id: table.id,
    name: table.name,
    description: table.description,
    schema: { columns: (table.schema as TableSchema).columns.map(normalizeColumn) },
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    locks: table.locks,
    workspaceId: table.workspaceId,
    folderId: table.folderId ?? null,
    createdBy: table.createdBy,
    createdAt: toWireDate(table.createdAt),
    updatedAt: toWireDate(table.updatedAt),
    archivedAt: table.archivedAt ? toWireDate(table.archivedAt) : null,
    jobStatus: table.jobStatus ?? null,
    jobId: table.jobId ?? null,
    jobType: table.jobType ?? null,
    jobError: table.jobError ?? null,
    jobRowsProcessed: table.jobRowsProcessed ?? 0,
  }))
}
