import { createHash } from 'crypto'
import { applyColumnOrderToSchema, getColumnId } from '@/lib/table/column-keys'
import type { TableMetadata, TableSchema } from '@/lib/table/types'

/**
 * Fingerprint of a table's column shape (id + display name + user-visible order). `rows_version`
 * only advances on row mutations (the trigger fires on `user_table_rows`), so a schema edit —
 * rename, add, remove, or reorder a column — is invisible to the version counter. Consumers that
 * key on `rows_version` (the snapshot cache, the copilot VFS snapshot) pair it with this hash so
 * schema changes are detected too.
 *
 * Pass `metadata` when `schema` is the RAW stored JSONB: the user-visible order lives in
 * `metadata.columnOrder` and is folded in here, so a pure reorder (metadata-only write) still
 * changes the hash. Callers holding an already order-applied schema (getTableById/listTables
 * output) can omit it — re-applying the same order is a no-op, so both paths hash identically.
 */
export function schemaFingerprint(schema: TableSchema, metadata?: TableMetadata | null): string {
  const ordered = applyColumnOrderToSchema(schema, metadata ?? null)
  const shape = ordered.columns.map((c) => [getColumnId(c), c.name])
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 12)
}
