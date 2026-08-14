import type { V2ApiTable } from '@/lib/api/contracts/v2/tables'
import type { RowData, TableDefinition, TableSchema } from '@/lib/table'
import { getMaxRowsPerTable } from '@/lib/table/billing'
import { buildColumnNameById, remapViewConfigColumnRefs } from '@/lib/table/column-keys'
import type { ColumnDefinition } from '@/lib/table/types'
import type { TableView } from '@/lib/table/views/service'
import { normalizeColumn } from '@/lib/table/wire'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'

/**
 * Shared serialization + error helpers for the v2 tables surface. Every v2
 * table/row/column route renders its payloads and access failures through these
 * so the public shape, timestamp format, and error envelope stay identical
 * across the surface. These reuse the v1 platform services and classifiers —
 * only the HTTP envelope is upgraded.
 */

/**
 * ISO-serializes a `Date | string` timestamp from the table service layer.
 *
 * Every current producer is a drizzle select over a `timestamp` column, so the
 * value arrives as a `Date`. The string branch normalizes rather than passing the
 * value through: the v2 contract promises a strict ISO-8601 instant, and a raw
 * Postgres literal (`2026-01-15 10:30:00+00`) would fail response validation.
 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function requireMaxRows(
  maxRowsByWorkspaceId: ReadonlyMap<string, number>,
  workspaceId: string
): number {
  const maxRows = maxRowsByWorkspaceId.get(workspaceId)
  if (maxRows === undefined) {
    throw new Error(`Table plan limit is missing for workspace ${workspaceId}`)
  }
  return maxRows
}

/**
 * Normalized public table shape — the same subset of fields the v1 surface
 * exposes, with timestamps serialized to ISO strings. Shared by every v2 table
 * endpoint so the table payload is identical across the surface.
 */
function serializeApiTable(
  table: TableDefinition,
  folderPath: string,
  ownerEmail: string,
  maxRows: number
): V2ApiTable {
  return {
    id: table.id,
    name: table.name,
    description: table.description ?? null,
    ownerEmail,
    schema: {
      columns: (table.schema as TableSchema).columns.map(normalizeColumn),
    },
    rowCount: table.rowCount,
    maxRows,
    folderPath,
    locks: table.locks,
    // `jobStatus` is the presence signal — the service leaves the whole group
    // null when the table is idle. Without this an async import could be
    // started and cancelled but never observed to completion or failure.
    job: table.jobStatus
      ? {
          id: table.jobId ?? null,
          type: table.jobType ?? null,
          status: table.jobStatus,
          rowsProcessed: table.jobRowsProcessed ?? 0,
          error: table.jobError ?? null,
        }
      : null,
    createdAt: toIso(table.createdAt),
    updatedAt: toIso(table.updatedAt),
  }
}

/** Resolves and serializes one table with public owner attribution. */
export async function toApiTable(table: TableDefinition, folderPath: string): Promise<V2ApiTable> {
  const [emailByUserId, maxRows] = await Promise.all([
    getUserEmailsByIds([table.createdBy]),
    getMaxRowsPerTable(table.workspaceId),
  ])
  return serializeApiTable(
    table,
    folderPath,
    requireResolvedUserEmail(emailByUserId, table.createdBy),
    maxRows
  )
}

/** Batch-resolves owner emails before serializing a table list. */
export async function toApiTables(
  entries: readonly { table: TableDefinition; folderPath: string }[]
): Promise<V2ApiTable[]> {
  const workspaceIds = [...new Set(entries.map(({ table }) => table.workspaceId))]
  const [emailByUserId, limits] = await Promise.all([
    getUserEmailsByIds(entries.map(({ table }) => table.createdBy)),
    Promise.all(
      workspaceIds.map(
        async (workspaceId) => [workspaceId, await getMaxRowsPerTable(workspaceId)] as const
      )
    ),
  ])
  const maxRowsByWorkspaceId = new Map(limits)
  return entries.map(({ table, folderPath }) =>
    serializeApiTable(
      table,
      folderPath,
      requireResolvedUserEmail(emailByUserId, table.createdBy),
      requireMaxRows(maxRowsByWorkspaceId, table.workspaceId)
    )
  )
}

/**
 * Normalized public view shape: ISO timestamps, and a `config` whose column
 * references are presented as column **names**.
 *
 * A view stores every column reference as a stable id so a rename cannot orphan
 * it — but the v2 surface is name-keyed everywhere else (row `data`, query
 * predicates, sort fields, and workflow groups via `presentV2WorkflowGroup`),
 * and a caller who never sees a `col_…` id cannot round-trip a config it reads
 * back into a create. The write path translates in the other direction, so the
 * pair is symmetric. A ref naming no current column (a since-deleted column in
 * a saved filter) is left as-is.
 */
export function toApiView(
  view: TableView,
  createdByEmail: string | null,
  columns: ColumnDefinition[]
) {
  return {
    id: view.id,
    tableId: view.tableId,
    name: view.name,
    config: remapViewConfigColumnRefs(view.config, buildColumnNameById(columns)),
    isDefault: view.isDefault,
    createdByEmail,
    createdAt: toIso(view.createdAt),
    updatedAt: toIso(view.updatedAt),
  }
}

/**
 * Maps a stored column id (the JSONB key that `findRowMatches` reports) back to
 * its display name, so cell references on the public wire are name-keyed like
 * row `data`. Falls back to the id for a column that no longer exists.
 */
export function columnNameById(schema: TableSchema): (columnId: string) => string {
  const nameById = buildColumnNameById(schema.columns)
  return (columnId) => nameById.get(columnId) ?? columnId
}

/**
 * Row fields the public API exposes. `data` is stored id-keyed; {@link toApiRow}
 * translates it to column names.
 */
interface ApiRowInput {
  id: string
  data: RowData
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Normalized public row shape: `{ id, data, createdAt, updatedAt }`, no storage
 * internals (`position`/`orderKey`/`executions`). Callers pass a
 * `namedRowMapper(schema.columns)` so `data` is keyed by column NAME and select
 * cells surface their option NAME rather than the stored option id.
 */
export function toApiRow(row: ApiRowInput, toNamedRow: (data: RowData) => RowData) {
  return {
    id: row.id,
    data: toNamedRow(row.data),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}
