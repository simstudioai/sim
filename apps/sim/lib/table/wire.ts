import { typeMetadataOf } from '@/lib/table/column-types'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

/**
 * Projects a stored column onto its wire form: optional flags defaulted and
 * type-specific metadata forwarded generically.
 *
 * Deliberately not re-exported from the `@/lib/table` barrel — routes that mock
 * the barrel wholesale would otherwise lose this projection and silently emit
 * unnormalized columns.
 */
export function normalizeColumn(
  col: ColumnDefinition
): ColumnDefinition & { required: boolean; unique: boolean } {
  return {
    // Preserve the stable column id — it's the row-data storage key, so dropping
    // it makes clients fall back to `name` and miss id-keyed cell values.
    ...(col.id ? { id: col.id } : {}),
    name: col.name,
    type: col.type,
    required: col.required ?? false,
    unique: col.unique ?? false,
    ...(col.workflowGroupId ? { workflowGroupId: col.workflowGroupId } : {}),
    // Type-specific metadata is forwarded generically: naming keys here meant a
    // new type's metadata was stored server-side but silently never returned.
    ...typeMetadataOf(col),
  }
}

/** Serializes a stored timestamp to the ISO string a table wire shape carries. */
export function toWireTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * Projects a stored table definition onto the exact shape
 * `GET /api/table` returns and `useTablesList` caches.
 *
 * The single source of truth for that shape: the route and the tables page
 * prefetch both call it, so a server-hydrated cache entry is indistinguishable
 * from one a client fetch produced. Timestamps become ISO strings (the client
 * never sees `Date` — the list contract's response schema is a passthrough
 * `z.custom`, so it neither coerces nor strips), columns are normalized, job
 * fields are defaulted, and `metadata` is withheld as server-only.
 */
export function toTableListItem(table: TableDefinition): TableDefinition {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: {
      columns: table.schema.columns.map(normalizeColumn),
    },
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    locks: table.locks,
    workspaceId: table.workspaceId,
    folderId: table.folderId ?? null,
    createdBy: table.createdBy,
    createdAt: toWireTimestamp(table.createdAt),
    updatedAt: toWireTimestamp(table.updatedAt),
    archivedAt: table.archivedAt ? toWireTimestamp(table.archivedAt) : null,
    jobStatus: table.jobStatus ?? null,
    jobId: table.jobId ?? null,
    jobType: table.jobType ?? null,
    jobError: table.jobError ?? null,
    jobRowsProcessed: table.jobRowsProcessed ?? 0,
  }
}
