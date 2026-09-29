/**
 * Keeps row writes on the table's live schema rather than the definition their caller resolved
 * before the write transaction opened.
 *
 * Schema changes hold the table's schema lock exclusively (`withLockedTable`) while they check the
 * stored rows against the new schema: a column made unique is scanned for duplicates, one made
 * required for empty cells. A write validated against an older definition skips the check the new
 * schema adds, and if it commits after that scan, the column ends up holding the duplicate or the
 * empty cell. Each write transaction therefore takes the schema lock shared and reads the schema
 * under it, then validates against that: a schema change waits for writes already in flight, and a
 * write that waited sees the change.
 */

import { compareStrings } from '@sim/utils/string'
import { sql } from 'drizzle-orm'
import { canonicalJson } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getColumnId } from '@/lib/table/column-keys'
import type { DbTransaction } from '@/lib/table/planner'
import { type TableTxTimeouts, tableTxTimeoutSettings } from '@/lib/table/tx'
import type { RowData, TableDefinition, TableSchema, ValidationResult } from '@/lib/table/types'
import {
  coerceRowToSchema,
  type PatchedKeys,
  type UncoercibleValuePolicy,
  validateRowSize,
} from '@/lib/table/validation'

/** Compares schemas by content, whatever order their columns are listed in. */
function schemaFingerprint(schema: TableSchema): string {
  const columns = [...schema.columns].sort((a, b) => compareStrings(getColumnId(a), getColumnId(b)))
  return canonicalJson({ ...schema, columns })
}

/** `table` itself when `schema` matches its schema, else a copy carrying `schema`. */
export function withLiveSchema(table: TableDefinition, schema: TableSchema): TableDefinition {
  return schemaFingerprint(schema) === schemaFingerprint(table.schema)
    ? table
    : { ...table, schema }
}

/**
 * Takes the table's schema lock shared and reads its live schema, and returns the definition to
 * validate and write against: `table` itself when its schema is still current, else a copy carrying
 * the live schema. Call it first in the transaction, before its other locks, passing the
 * transaction's `timeouts` (see `setTableTxTimeouts`) in place of a separate timeouts statement.
 *
 * One statement: `user_table_schema_for_write` (script migration 0026) takes the lock and then
 * reads the schema. It is VOLATILE, so under READ COMMITTED its read takes a fresh snapshot and sees
 * a schema change that committed while the lock waited. The timeouts are applied in a subquery the call
 * reads from, first. The lock waits as long as the transaction's `statement_timeout` allows, not
 * its shorter `lock_timeout`, which the function leaves as it found it for the locks that follow.
 */
export async function lockLiveTableSchema(
  trx: DbTransaction,
  table: TableDefinition,
  timeouts?: TableTxTimeouts
): Promise<TableDefinition> {
  const read = sql`SELECT user_table_schema_for_write(${table.id}) AS schema`
  const [live] = await trx.execute<{ schema: TableSchema | null }>(
    timeouts ? sql`${read} FROM (SELECT ${tableTxTimeoutSettings(timeouts)}) AS settings` : read
  )
  if (!live?.schema) throw new OrchestrationError('not_found', 'Table not found')
  return withLiveSchema(table, live.schema)
}

/**
 * Removes, in place, the cells of columns `snapshot` defines and `live` no longer does. A column
 * delete reclaims its cells in the background, so a cell written after that pass would stay behind.
 */
export function dropDeletedColumns(
  rows: readonly RowData[],
  snapshot: TableSchema,
  live: TableSchema
): void {
  const liveIds = new Set(live.columns.map(getColumnId))
  const deleted = snapshot.columns.map(getColumnId).filter((id) => !liveIds.has(id))
  if (deleted.length === 0) return
  for (const row of rows) {
    for (const id of deleted) delete row[id]
  }
}

/**
 * Rebuilds `row`, in place, for `live` once the schema has moved since `snapshot`: from `raw`, the
 * row as the caller wrote it before coercing it against `snapshot`, so a value that schema would
 * have reshaped (`"007"` read as a number) reaches the live column as it was sent. Then drops the
 * cells of deleted columns, coerces and validates against `live` exactly as the write first did,
 * and re-checks the row's size, which a coercion to a wider type can grow.
 */
export function refitRowToSchema(
  row: RowData,
  raw: RowData,
  snapshot: TableSchema,
  live: TableSchema,
  policy?: UncoercibleValuePolicy,
  patchedKeys?: PatchedKeys
): ValidationResult {
  for (const key of Object.keys(row)) delete row[key]
  Object.assign(row, raw)
  dropDeletedColumns([row], snapshot, live)
  const result = coerceRowToSchema(row, live, policy, patchedKeys)
  return result.valid ? validateRowSize(row) : result
}
