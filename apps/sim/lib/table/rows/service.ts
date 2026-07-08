/**
 * Row CRUD + query operations for the table service layer.
 *
 * Holds the row-write group (`insertRow`, `batchInsertRows`, `upsertRow`,
 * `updateRow`, `deleteRow`, the bulk/filter variants, `replaceTableRows`) and the
 * row-read group (`queryRows`, `getRowById`, `findRowMatches`). Mirrors the
 * `@/lib/table` service conventions: plain exported async functions, drizzle
 * inline, no repository pattern.
 *
 * Re-exported through the `@/lib/table` barrel.
 */

import { db } from '@sim/db'
import { tableJobs, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, lte, notInArray, type SQL, sql } from 'drizzle-orm'
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { nKeysBetween } from '@/lib/table/order-key'
import { type DbExecutor, type DbTransaction, withSeqscanOff } from '@/lib/table/planner'
import {
  applyExecutionsPatch,
  deriveExecClearsForDataPatch,
  loadExecutionsByRow,
  loadExecutionsForRow,
  writeExecutionsPatch,
} from '@/lib/table/rows/executions'
import {
  acquireRowOrderLock,
  deleteOrderedRow,
  deleteOrderedRowsByIds,
  insertOrderedRow,
  nextRowPosition,
  resolveBatchInsertOrderKeys,
  resolveInsertOrderKey,
} from '@/lib/table/rows/ordering'
import { buildFilterClause, buildSortClause, escapeLikePattern } from '@/lib/table/sql'
import { fireTableTrigger } from '@/lib/table/trigger'
import { scaledStatementTimeoutMs, setTableTxTimeouts } from '@/lib/table/tx'
import type {
  BatchInsertData,
  BatchUpdateByIdData,
  BulkDeleteByIdsData,
  BulkDeleteByIdsResult,
  BulkDeleteData,
  BulkOperationResult,
  BulkUpdateData,
  ColumnDefinition,
  Filter,
  InsertRowData,
  QueryOptions,
  QueryResult,
  ReplaceRowsData,
  ReplaceRowsResult,
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  Sort,
  TableDefinition,
  TableDeleteJobPayload,
  TableRow,
  UpdateRowData,
  UpsertResult,
  UpsertRowData,
} from '@/lib/table/types'
import {
  checkBatchUniqueConstraintsDb,
  checkUniqueConstraintsDb,
  coerceRowToSchema,
  coerceRowValues,
  getUniqueColumns,
  validateRowSize,
} from '@/lib/table/validation'
import { cancelWorkflowGroupRuns, runWorkflowColumn } from '@/lib/table/workflow-columns'

const logger = createLogger('TableRowsService')

/**
 * Inserts a single row into a table.
 *
 * @param data - Row insertion data
 * @param table - Table definition (to avoid re-fetching)
 * @param requestId - Request ID for logging
 * @returns Inserted row
 * @throws Error if validation fails or capacity exceeded
 */
export async function insertRow(
  data: InsertRowData,
  table: TableDefinition,
  requestId: string
): Promise<TableRow> {
  // Validate row size
  const sizeValidation = validateRowSize(data.data)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  // Validate against schema
  const schemaValidation = coerceRowToSchema(data.data, table.schema)
  if (!schemaValidation.valid) {
    throw new Error(`Schema validation failed: ${schemaValidation.errors.join(', ')}`)
  }

  // Check unique constraints using optimized database query
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueValidation = await checkUniqueConstraintsDb(data.tableId, data.data, table.schema)
    if (!uniqueValidation.valid) {
      throw new Error(uniqueValidation.errors.join(', '))
    }
  }

  const rowId = `row_${generateId().replace(/-/g, '')}`
  const now = new Date()

  // Capacity enforcement lives in the `increment_user_table_row_count` trigger
  // (migration 0198): a single conditional UPDATE on user_table_definitions
  // increments row_count iff row_count < max_rows, taking the row lock
  // atomically. No app-level FOR UPDATE / COUNT needed.
  const row = await insertOrderedRow({
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: data.data,
    rowId,
    position: data.position,
    afterRowId: data.afterRowId,
    beforeRowId: data.beforeRowId,
    createdBy: data.userId,
    now,
  })

  logger.info(`[${requestId}] Inserted row ${rowId} into table ${data.tableId}`)

  const insertedRow: TableRow = {
    id: row.id,
    data: row.data as RowData,
    executions: {},
    position: row.position,
    orderKey: row.orderKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }

  void fireTableTrigger(
    data.tableId,
    table.name,
    'insert',
    [insertedRow],
    null,
    table.schema,
    requestId
  )
  void runWorkflowColumn({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds: [insertedRow.id],
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: data.userId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (insertRow) failed:`, err))

  return insertedRow
}

/**
 * Inserts multiple rows into a table.
 *
 * @param data - Batch insertion data
 * @param table - Table definition
 * @param requestId - Request ID for logging
 * @returns Array of inserted rows
 * @throws Error if validation fails or capacity exceeded
 */
export async function batchInsertRows(
  data: BatchInsertData,
  table: TableDefinition,
  requestId: string
): Promise<TableRow[]> {
  const result = await db.transaction((trx) => batchInsertRowsWithTx(trx, data, table, requestId))
  dispatchAfterBatchInsert(table, result, requestId, data.userId)
  return result
}

/**
 * Transaction-bound variant of `batchInsertRows`. Validates rows and unique
 * constraints, then performs INSERTs inside the provided transaction. Caller
 * is responsible for opening the transaction. Use when row inserts must be
 * atomic with other writes (e.g., schema mutations) on the same tx.
 *
 * Capacity enforcement lives in the `increment_user_table_row_count` trigger
 * (migration 0198) — fires per row and raises `Maximum row limit (%) reached ...`
 * if the cap is hit mid-batch.
 */
export async function batchInsertRowsWithTx(
  trx: DbTransaction,
  data: BatchInsertData,
  table: TableDefinition,
  requestId: string
): Promise<TableRow[]> {
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i]

    const sizeValidation = validateRowSize(row)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${i + 1}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = coerceRowToSchema(row, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${i + 1}: ${schemaValidation.errors.join(', ')}`)
    }
  }

  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueResult = await checkBatchUniqueConstraintsDb(
      data.tableId,
      data.rows,
      table.schema,
      trx
    )
    if (!uniqueResult.valid) {
      const errorMessages = uniqueResult.errors
        .map((e) => `Row ${e.row + 1}: ${e.errors.join(', ')}`)
        .join('; ')
      throw new Error(errorMessages)
    }
  }

  const now = new Date()

  await setTableTxTimeouts(trx, { statementMs: 60_000 })

  const buildRow = (rowData: RowData, position: number, orderKey: string) => ({
    id: `row_${generateId().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    position,
    orderKey,
    createdAt: now,
    updatedAt: now,
    ...(data.userId ? { createdBy: data.userId } : {}),
  })

  await acquireRowOrderLock(trx, data.tableId)
  // Undo restore passes exact saved keys; otherwise append after the current max.
  const orderKeys =
    data.orderKeys && data.orderKeys.length > 0
      ? data.orderKeys
      : await resolveBatchInsertOrderKeys(trx, data.tableId, data.rows.length)
  // order_key is authoritative — best-effort append positions, no shift.
  const start = await nextRowPosition(trx, data.tableId)
  const positions = Array.from({ length: data.rows.length }, (_, i) => start + i)
  const rowsToInsert = data.rows.map((rowData, i) => buildRow(rowData, positions[i], orderKeys[i]))
  const insertedRows = await trx.insert(userTableRows).values(rowsToInsert).returning()

  logger.info(`[${requestId}] Batch inserted ${data.rows.length} rows into table ${data.tableId}`)

  const result: TableRow[] = insertedRows.map((r) => ({
    id: r.id,
    data: r.data as RowData,
    executions: {},
    position: r.position,
    orderKey: r.orderKey ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))

  return result
}

/**
 * Side-effect dispatch for an insert batch. Caller fires this AFTER the
 * surrounding transaction commits — `fireTableTrigger` and `runWorkflowColumn`
 * both read through the global db connection, so firing inside the tx can see
 * no rows and no-op.
 */
export function dispatchAfterBatchInsert(
  table: TableDefinition,
  result: TableRow[],
  requestId: string,
  actorUserId?: string | null
): void {
  void fireTableTrigger(table.id, table.name, 'insert', result, null, table.schema, requestId)
  // Scope to the newly-inserted row ids so the dispatcher doesn't walk every
  // row in the table. After the sidecar migration, all existing rows have
  // zero entries → `mode:'new'`'s `NOT EXISTS` filter would otherwise include
  // them, dispatching workflows on every row in a populated table.
  void runWorkflowColumn({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds: result.map((r) => r.id),
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: actorUserId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (batchInsertRows) failed:`, err))
}

/**
 * Replaces all rows in a table with a new set of rows. Deletes existing rows
 * and inserts the provided rows inside a single transaction so the table is
 * never observed in an empty intermediate state by other readers.
 *
 * Validates each row against the schema, enforces unique constraints within the
 * new rows (existing rows are deleted, so DB-side checks are unnecessary), and
 * enforces `maxRows` before the replace executes.
 *
 * @param data - Replace data (rows to install)
 * @param table - Table definition
 * @param requestId - Request ID for logging
 * @returns Count of rows deleted and inserted
 * @throws Error if validation fails or capacity exceeded
 */
export async function replaceTableRows(
  data: ReplaceRowsData,
  table: TableDefinition,
  requestId: string
): Promise<ReplaceRowsResult> {
  return db.transaction((trx) => replaceTableRowsWithTx(trx, data, table, requestId))
}

/**
 * Transaction-bound variant of `replaceTableRows`. Caller opens the transaction.
 * Use when the replace must be atomic with other writes (e.g., schema mutations).
 */
export async function replaceTableRowsWithTx(
  trx: DbTransaction,
  data: ReplaceRowsData,
  table: TableDefinition,
  requestId: string
): Promise<ReplaceRowsResult> {
  if (data.tableId !== table.id) {
    throw new Error(`Table ID mismatch: ${data.tableId} vs ${table.id}`)
  }
  if (data.workspaceId !== table.workspaceId) {
    throw new Error(`Workspace ID mismatch: ${data.workspaceId} does not own table ${data.tableId}`)
  }
  if (data.rows.length > table.maxRows) {
    throw new Error(
      `Cannot replace: ${data.rows.length} rows exceeds table row limit (${table.maxRows})`
    )
  }

  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i]

    const sizeValidation = validateRowSize(row)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${i + 1}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = coerceRowToSchema(row, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${i + 1}: ${schemaValidation.errors.join(', ')}`)
    }
  }

  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0 && data.rows.length > 0) {
    const seen = new Map<string, Map<string, number>>()
    for (const col of uniqueColumns) {
      seen.set(col.name, new Map())
    }
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i]
      for (const col of uniqueColumns) {
        const value = row[col.name]
        if (value === null || value === undefined) continue
        const normalized = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value)
        const map = seen.get(col.name)!
        if (map.has(normalized)) {
          throw new Error(
            `Row ${i + 1}: Column "${col.name}" must be unique. Value "${String(value)}" duplicates row ${map.get(normalized)! + 1} in batch`
          )
        }
        map.set(normalized, i)
      }
    }
  }

  const now = new Date()

  const totalRowWork = Math.max(0, table.rowCount ?? 0) + data.rows.length
  const statementMs = scaledStatementTimeoutMs(totalRowWork, {
    baseMs: 120_000,
    perRowMs: 3,
  })

  await setTableTxTimeouts(trx, { statementMs })

  // Serialize concurrent replaces (and concurrent auto-position inserts) on the
  // same table. Without this, two concurrent replaces each see their own MVCC
  // snapshot for the DELETE; the second's DELETE would not observe rows the
  // first inserted, so both transactions commit and the table ends up with
  // the union of both row sets instead of only the last caller's rows.
  await acquireRowOrderLock(trx, data.tableId)

  const deletedRows = await trx
    .delete(userTableRows)
    .where(eq(userTableRows.tableId, data.tableId))
    .returning({ id: userTableRows.id })

  let insertedCount = 0
  if (data.rows.length > 0) {
    // All prior rows were just deleted — assign a fresh contiguous key run.
    const orderKeys = nKeysBetween(null, null, data.rows.length)
    const rowsToInsert = data.rows.map((rowData, i) => ({
      id: `row_${generateId().replace(/-/g, '')}`,
      tableId: data.tableId,
      workspaceId: data.workspaceId,
      data: rowData,
      position: i,
      orderKey: orderKeys[i],
      createdAt: now,
      updatedAt: now,
      ...(data.userId ? { createdBy: data.userId } : {}),
    }))

    const batchSize = TABLE_LIMITS.MAX_BATCH_INSERT_SIZE
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize)
      const inserted = await trx.insert(userTableRows).values(chunk).returning({
        id: userTableRows.id,
      })
      insertedCount += inserted.length
    }
  }

  logger.info(
    `[${requestId}] Replaced rows in table ${data.tableId}: deleted ${deletedRows.length}, inserted ${insertedCount}`
  )

  return { deletedCount: deletedRows.length, insertedCount }
}

/**
 * Upserts a row: updates an existing row if a match is found on the conflict target
 * column, otherwise inserts a new row.
 *
 * Uses a single unique column for matching (not OR across all unique columns) to avoid
 * ambiguous matches when multiple unique columns exist. Capacity enforcement lives
 * in the `increment_user_table_row_count` trigger (migration 0198). On the insert
 * path we acquire the per-table advisory lock and re-check for an existing match
 * before inserting, so a concurrent upsert racing on the same conflict target
 * cannot produce a duplicate row.
 *
 * @param data - Upsert data including optional conflictTarget
 * @param table - Table definition
 * @param requestId - Request ID for logging
 * @returns The upserted row and whether it was an insert or update
 * @throws Error if no unique columns, ambiguous conflict target, or capacity exceeded
 */
export async function upsertRow(
  data: UpsertRowData,
  table: TableDefinition,
  requestId: string
): Promise<UpsertResult> {
  const schema = table.schema
  const uniqueColumns = getUniqueColumns(schema)

  if (uniqueColumns.length === 0) {
    throw new Error(
      'Upsert requires at least one unique column in the schema. Please add a unique constraint to a column or use insert instead.'
    )
  }

  // Determine the single conflict target column, resolving to its stable
  // storage id (the row-data key). `conflictTarget` may arrive as an id
  // (first-party) or a name (legacy/internal) — match either.
  let targetColumnKey: string
  if (data.conflictTarget) {
    const col = uniqueColumns.find(
      (c) => getColumnId(c) === data.conflictTarget || c.name === data.conflictTarget
    )
    if (!col) {
      throw new Error(
        `Column "${data.conflictTarget}" is not a unique column. Available unique columns: ${uniqueColumns.map((c) => c.name).join(', ')}`
      )
    }
    targetColumnKey = getColumnId(col)
  } else if (uniqueColumns.length === 1) {
    targetColumnKey = getColumnId(uniqueColumns[0])
  } else {
    throw new Error(
      `Table has multiple unique columns (${uniqueColumns.map((c) => c.name).join(', ')}). Specify conflictTarget to indicate which column to match on.`
    )
  }

  // Validate row data
  const sizeValidation = validateRowSize(data.data)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  const schemaValidation = coerceRowToSchema(data.data, schema)
  if (!schemaValidation.valid) {
    throw new Error(`Schema validation failed: ${schemaValidation.errors.join(', ')}`)
  }

  // Read the conflict-target value *after* coercion so `matchFilter` branches on
  // the persisted type (e.g. a coerced `"123"` → `123` matches existing rows).
  const targetValue = data.data[targetColumnKey]
  if (targetValue === undefined || targetValue === null) {
    // Surface the display name, not the internal id — v1 callers pass a name.
    const targetColumnName =
      uniqueColumns.find((c) => getColumnId(c) === targetColumnKey)?.name ?? targetColumnKey
    throw new Error(`Upsert requires a value for the conflict target column "${targetColumnName}"`)
  }

  // `data->` and `data->>` accept the JSON key as a parameterized text value;
  // no need for `sql.raw` interpolation.
  const matchFilter =
    typeof targetValue === 'string'
      ? sql`${userTableRows.data}->>${targetColumnKey}::text = ${String(targetValue)}`
      : sql`(${userTableRows.data}->${targetColumnKey}::text)::jsonb = ${JSON.stringify(targetValue)}::jsonb`

  // Capacity enforcement for the insert path lives in the `increment_user_table_row_count`
  // trigger (migration 0198). The update path doesn't change row_count, so no check needed.
  const result = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    // The conflict lookups below match on `data->>key` — unestimatable, and an
    // insert-path upsert (no existing match) can't exit early, so the planner
    // would seq-scan the whole shared relation. See withSeqscanOff.
    await trx.execute(sql`SET LOCAL enable_seqscan = off`)

    // Find existing row by single conflict target column
    const [existingRow] = await trx
      .select()
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, data.tableId),
          eq(userTableRows.workspaceId, data.workspaceId),
          matchFilter
        )
      )
      .limit(1)

    // Check uniqueness on ALL unique columns (not just the conflict target)
    const uniqueValidation = await checkUniqueConstraintsDb(
      data.tableId,
      data.data,
      schema,
      existingRow?.id, // exclude the matched row on updates
      trx
    )
    if (!uniqueValidation.valid) {
      throw new Error(`Unique constraint violation: ${uniqueValidation.errors.join(', ')}`)
    }

    const now = new Date()

    // Resolve which row (if any) we should update. If the initial SELECT missed,
    // acquire the lock and re-check — a concurrent upsert may have inserted the
    // matching row between our SELECT and the INSERT path; without the re-check
    // both transactions would insert and bypass the app-level unique check.
    let matchedRowId = existingRow?.id
    let previousData = existingRow?.data as RowData | undefined
    if (!matchedRowId) {
      await acquireRowOrderLock(trx, data.tableId)
      const [racedRow] = await trx
        .select({ id: userTableRows.id, data: userTableRows.data })
        .from(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, data.tableId),
            eq(userTableRows.workspaceId, data.workspaceId),
            matchFilter
          )
        )
        .limit(1)
      if (racedRow) {
        matchedRowId = racedRow.id
        previousData = racedRow.data as RowData
      }
    }

    if (matchedRowId) {
      const [updatedRow] = await trx
        .update(userTableRows)
        .set({ data: data.data, updatedAt: now })
        .where(eq(userTableRows.id, matchedRowId))
        .returning()

      const executions = await loadExecutionsForRow(trx, updatedRow.id)
      return {
        row: {
          id: updatedRow.id,
          data: updatedRow.data as RowData,
          executions,
          position: updatedRow.position,
          orderKey: updatedRow.orderKey ?? undefined,
          createdAt: updatedRow.createdAt,
          updatedAt: updatedRow.updatedAt,
        },
        previousData,
        operation: 'update' as const,
      }
    }

    const [insertedRow] = await trx
      .insert(userTableRows)
      .values({
        id: `row_${generateId().replace(/-/g, '')}`,
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        data: data.data,
        position: await nextRowPosition(trx, data.tableId),
        orderKey: await resolveInsertOrderKey(trx, data.tableId),
        createdAt: now,
        updatedAt: now,
        ...(data.userId ? { createdBy: data.userId } : {}),
      })
      .returning()

    return {
      row: {
        id: insertedRow.id,
        data: insertedRow.data as RowData,
        executions: {},
        position: insertedRow.position,
        orderKey: insertedRow.orderKey ?? undefined,
        createdAt: insertedRow.createdAt,
        updatedAt: insertedRow.updatedAt,
      },
      operation: 'insert' as const,
    }
  })

  logger.info(
    `[${requestId}] Upserted (${result.operation}) row ${result.row.id} in table ${data.tableId}`
  )

  if (result.operation === 'insert') {
    void fireTableTrigger(
      data.tableId,
      table.name,
      'insert',
      [result.row],
      null,
      table.schema,
      requestId
    )
  } else if (result.operation === 'update' && result.previousData) {
    const oldRows = new Map([[result.row.id, result.previousData]])
    void fireTableTrigger(
      data.tableId,
      table.name,
      'update',
      [result.row],
      oldRows,
      table.schema,
      requestId
    )
  }
  void runWorkflowColumn({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds: [result.row.id],
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: data.userId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (upsertRow) failed:`, err))

  return result
}

/**
 * Canonical ORDER BY for a table's rows, shared by `queryRows` (the paginated
 * list) and `findRowMatches` so a match's ordinal lines up with its index in
 * the list. Order: explicit data sort (if any) → fractional `order_key` → `id`.
 * The `id` tiebreak is always appended so equal keys order deterministically —
 * without it two separate query executions (a find vs a list page) could shuffle
 * ties and misalign ordinals.
 */
function buildRowOrderBySql(
  sort: Sort | undefined,
  tableName: string,
  columns: ColumnDefinition[]
): SQL {
  const primary = `${tableName}.order_key`
  const id = `${tableName}.id`
  if (sort && Object.keys(sort).length > 0) {
    const sortClause = buildSortClause(sort, tableName, columns)
    if (sortClause) {
      return sql.join([sortClause, sql.raw(primary), sql.raw(id)], sql.raw(', '))
    }
  }
  return sql.raw(`${primary}, ${id}`)
}

/** One matching cell from {@link findRowMatches}. */
export interface FindRowMatch {
  /** 0-based index of the row in the filtered+sorted view (aligns with the list query). */
  ordinal: number
  rowId: string
  /** Stable column id of the matching cell (the JSONB storage key), not the display name. */
  column: string
}

/** Max matching cells returned by {@link findRowMatches}; one extra is fetched to detect truncation. */
const FIND_MATCH_LIMIT = 1000

/**
 * Case-insensitive substring search across every cell of a table's rows. Each
 * matching cell becomes a {@link FindRowMatch} carrying its row id, column, and
 * 0-based ordinal in the filtered+sorted view (so the client can page up to and
 * reveal it). `filter`/`sort` mirror the active list view via
 * {@link buildRowOrderBySql}, keeping ordinals aligned.
 *
 * Cost: one pass over the table's rows — `ILIKE` over `jsonb_each_text` cannot
 * use the JSONB GIN index, and the ordinal's `row_number()` needs every row
 * counted regardless. The planner can't estimate the lateral ILIKE (jsonb is
 * opaque to it), so left alone it seq-scans the entire shared relation and
 * disk-sorts the window input (measured 75s on a 1M-row table in a 12M-row
 * relation). `SET LOCAL` planner flags keep it tenant-bounded; on the default
 * order they additionally force the streaming `(table_id, order_key, id)` index
 * walk where `row_number()` needs no sort at all (measured 2s). A `pg_trgm` GIN
 * index on a text projection is the future accelerator if needed.
 */
export async function findRowMatches(
  table: TableDefinition,
  options: { q: string; filter?: Filter; sort?: Sort },
  requestId: string
): Promise<{ matches: FindRowMatch[]; truncated: boolean }> {
  const tableName = USER_TABLE_ROWS_SQL_NAME
  const columns = table.schema.columns
  // Row data is keyed by stable column id, so scan/return JSONB keys as ids.
  const columnIds = columns.map(getColumnId)
  if (columnIds.length === 0) return { matches: [], truncated: false }

  // Same visibility rule as queryRows: don't surface rows a running delete job will remove.
  const deleteMask = await pendingDeleteMask(table)

  const baseConditions = and(
    eq(userTableRows.tableId, table.id),
    eq(userTableRows.workspaceId, table.workspaceId),
    deleteMask
  )
  let whereClause: SQL | undefined = baseConditions
  if (options.filter && Object.keys(options.filter).length > 0) {
    const filterClause = buildFilterClause(options.filter, tableName, columns)
    if (filterClause) whereClause = and(baseConditions, filterClause)
  }

  const orderBySql = buildRowOrderBySql(options.sort, tableName, columns)
  const pattern = `%${escapeLikePattern(options.q)}%`

  const result = await db.transaction(async (trx) => {
    // Planner flags, not correctness: `enable_* = off` only penalizes a plan shape, so a
    // genuinely required sort still runs. Seqscan off keeps the scan inside the tenant's rows
    // (the lateral ILIKE is unestimatable, so the planner otherwise walks the whole shared
    // relation). On the default order, the remaining flags steer to the already-sorted
    // `(table_id, order_key, id)` index walk so the window function streams without a 100MB+
    // disk sort; a custom sort has no index to stream from, so those flags would only distort
    // that plan.
    await trx.execute(sql`SET LOCAL enable_seqscan = off`)
    if (!options.sort) {
      await trx.execute(sql`SET LOCAL enable_bitmapscan = off`)
      await trx.execute(sql`SET LOCAL enable_sort = off`)
      await trx.execute(sql`SET LOCAL max_parallel_workers_per_gather = 0`)
    }
    return trx.execute<{
      ordinal: string | number
      id: string
      column_name: string
    }>(sql`
      WITH ordered AS (
        SELECT id, data, row_number() OVER (ORDER BY ${orderBySql}) - 1 AS ordinal
        FROM ${userTableRows}
        WHERE ${whereClause}
      )
      SELECT o.ordinal, o.id, kv.key AS column_name
      FROM ordered o
      CROSS JOIN LATERAL jsonb_each_text(o.data) kv
      WHERE kv.value ILIKE ${pattern}
        AND ${inArray(sql`kv.key`, columnIds)}
      ORDER BY o.ordinal
      LIMIT ${FIND_MATCH_LIMIT + 1}
    `)
  })

  const all = Array.from(result)
  const truncated = all.length > FIND_MATCH_LIMIT
  const sliced = truncated ? all.slice(0, FIND_MATCH_LIMIT) : all
  const matches: FindRowMatch[] = sliced.map((r) => ({
    ordinal: Number(r.ordinal),
    rowId: r.id,
    column: r.column_name,
  }))

  logger.info(
    `[${requestId}] Find "${options.q}" in table ${table.id}: ${matches.length} match(es)${truncated ? ' (truncated)' : ''}`
  )

  return { matches, truncated }
}

/**
 * Queries rows from a table with filtering, sorting, and pagination.
 *
 * Filter cost model: equality filters (`$eq`, `$in`) compile to JSONB
 * containment (`@>`) and hit the GIN (jsonb_path_ops) index on
 * `user_table_rows.data`. Range operators (`$gt`, `$gte`, `$lt`, `$lte`) and
 * `$contains` compile to `data->>'field'` text extraction and bypass the GIN
 * index — they fall back to a sequential scan of the rows for the table
 * (bounded only by the btree on `table_id`). Prefer equality on hot paths; set
 * `includeTotal: false` when the caller does not need the `COUNT(*)`.
 *
 * @param table - Table definition (provides id, workspaceId, and column schema for type-aware filter/sort casts)
 * @param options - Query options (filter, sort, limit, offset)
 * @param requestId - Request ID for logging
 * @returns Query result with rows and pagination info
 */
/**
 * Visibility mask for a running delete job: returns a clause keeping only rows the job will NOT
 * delete, or `undefined` when no delete job is running. The job's persisted scope
 * ({@link TableDeleteJobPayload}) defines the doomed set — `matches(filter) AND created_at <=
 * cutoff AND id NOT IN excludeRowIds` — exactly what the worker's `selectRowIdPage` selects, so
 * mid-job reads (refresh, other clients, exports) are consistent with the eventual result. The
 * mask lifts automatically when the job leaves `running` (done, failed, or canceled).
 *
 * `(doomed) IS NOT TRUE` rather than `NOT (doomed)`: JSONB predicates evaluate to NULL on missing
 * cells, and those rows are NOT selected for deletion (NULL ≠ TRUE) — they must stay visible.
 */
export async function pendingDeleteMask(table: TableDefinition): Promise<SQL | undefined> {
  const [job] = await db
    .select({ payload: tableJobs.payload })
    .from(tableJobs)
    .where(
      and(
        eq(tableJobs.tableId, table.id),
        eq(tableJobs.status, 'running'),
        eq(tableJobs.type, 'delete')
      )
    )
    .limit(1)
  if (!job?.payload) return undefined
  const scope = job.payload as TableDeleteJobPayload

  const doomedParts: SQL[] = []
  if (scope.filter && Object.keys(scope.filter).length > 0) {
    try {
      const clause = buildFilterClause(scope.filter, USER_TABLE_ROWS_SQL_NAME, table.schema.columns)
      if (clause) doomedParts.push(clause)
    } catch (error) {
      // Schema drifted mid-job (column renamed/deleted). Showing doomed rows briefly beats
      // failing every read; the worker resolves the same way on its next page.
      logger.warn(`Skipping delete-job mask for table ${table.id}: stale filter`, {
        error: toError(error).message,
      })
      return undefined
    }
  }
  if (scope.cutoff) doomedParts.push(lte(userTableRows.createdAt, new Date(scope.cutoff)))
  if (scope.excludeRowIds && scope.excludeRowIds.length > 0) {
    doomedParts.push(notInArray(userTableRows.id, scope.excludeRowIds))
  }
  if (doomedParts.length === 0) return undefined
  return sql`(${and(...doomedParts)}) IS NOT TRUE`
}

/**
 * `COUNT(*)` for a filtered view, kept inside the tenant's rows: measured
 * 12.7s → 1.0s counting a rare ILIKE filter on a 1M-row table inside a 12M-row
 * relation (see {@link withSeqscanOff} for why the planner gets this wrong).
 */
async function countRowsTenantBounded(whereClause: SQL | undefined): Promise<number> {
  return withSeqscanOff(async (trx) => {
    const [result] = await trx.select({ count: count() }).from(userTableRows).where(whereClause)
    return Number(result.count)
  })
}

export async function queryRows(
  table: TableDefinition,
  options: QueryOptions,
  requestId: string
): Promise<QueryResult> {
  const {
    filter,
    sort,
    limit = TABLE_LIMITS.DEFAULT_QUERY_LIMIT,
    offset = 0,
    after,
    includeTotal = true,
    withExecutions = true,
  } = options

  const tableName = USER_TABLE_ROWS_SQL_NAME
  const columns = table.schema.columns

  // Hide rows a running delete job is about to remove — both the page and the count below share
  // this clause, so totals stay consistent with the visible rows.
  const deleteMask = await pendingDeleteMask(table)

  const baseConditions = and(
    eq(userTableRows.tableId, table.id),
    eq(userTableRows.workspaceId, table.workspaceId),
    deleteMask
  )

  let whereClause = baseConditions
  if (filter && Object.keys(filter).length > 0) {
    const filterClause = buildFilterClause(filter, tableName, columns)
    if (filterClause) {
      whereClause = and(baseConditions, filterClause)
    }
  }

  // Keyset page: seek past the cursor on the default `(order_key, id)` order instead of paying
  // OFFSET's scan-and-discard of every prior row (O(N²) across a deep scroll / full drain). Only
  // valid without a custom sort — the contract rejects `after` + `sort` together. The count below
  // deliberately excludes the cursor: totals cover the whole view, not the remaining pages.
  const pageWhere =
    after && !sort
      ? and(
          whereClause,
          sql`(${userTableRows.orderKey}, ${userTableRows.id}) > (${after.orderKey}, ${after.id})`
        )
      : whereClause

  const buildPageQuery = (executor: DbExecutor) => {
    const query = executor
      .select()
      .from(userTableRows)
      .where(pageWhere ?? baseConditions)
      .orderBy(buildRowOrderBySql(sort, tableName, columns))
    return after ? query.limit(limit) : query.limit(limit).offset(offset)
  }

  // Count and page fetch are independent reads — run them concurrently so the
  // `includeTotal` hot path doesn't pay two serial round-trips. Filtered counts
  // go through the tenant-bounded variant (see countRowsTenantBounded); the
  // unfiltered count already plans an index-only scan on the table_id prefix.
  // Custom column sorts order by `data->>'col'` — unestimatable, so left alone
  // the planner seq-scans and sorts the whole shared relation on every page
  // (9.7s measured on a 1M-row table; 0.76s tenant-bounded). Default-order
  // pages already stream the `(table_id, order_key, id)` index.
  const hasFilter = Boolean(filter && Object.keys(filter).length > 0)
  const rowsPromise = sort ? withSeqscanOff(async (trx) => buildPageQuery(trx)) : buildPageQuery(db)
  const countPromise = includeTotal
    ? hasFilter
      ? countRowsTenantBounded(whereClause)
      : db
          .select({ count: count() })
          .from(userTableRows)
          .where(whereClause ?? baseConditions)
          .then((r) => Number(r[0].count))
    : null

  const [rows, totalCount] = await Promise.all([rowsPromise, countPromise])

  const executionsByRow = withExecutions
    ? await loadExecutionsByRow(
        db,
        rows.map((r) => r.id)
      )
    : null

  logger.info(
    `[${requestId}] Queried ${rows.length} rows from table ${table.id} (total: ${totalCount})`
  )

  return {
    rows: rows.map((r) => ({
      id: r.id,
      data: r.data as RowData,
      executions: executionsByRow?.get(r.id) ?? {},
      position: r.position,
      orderKey: r.orderKey ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    rowCount: rows.length,
    totalCount,
    limit,
    offset,
  }
}

/**
 * Gets a single row by ID.
 *
 * @param tableId - Table ID
 * @param rowId - Row ID to fetch
 * @param workspaceId - Workspace ID for access control
 * @returns Row or null if not found
 */
export async function getRowById(
  tableId: string,
  rowId: string,
  workspaceId: string
): Promise<TableRow | null> {
  const results = await db
    .select()
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.id, rowId),
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId)
      )
    )
    .limit(1)

  if (results.length === 0) return null

  const row = results[0]
  const executions = await loadExecutionsForRow(db, row.id)
  return {
    id: row.id,
    data: row.data as RowData,
    executions,
    position: row.position,
    orderKey: row.orderKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Internal: thrown inside `db.transaction` to roll back when the executions
 *  guard rejects a write. The outer `.catch` translates it into a `null` return. */
class GuardRejected extends Error {
  constructor() {
    super('cell-write guard rejected')
  }
}

/**
 * Updates a single row.
 *
 * @param data - Update data
 * @param table - Table definition
 * @param requestId - Request ID for logging
 * @returns Updated row
 * @throws Error if row not found or validation fails
 */
export async function updateRow(
  data: UpdateRowData,
  table: TableDefinition,
  requestId: string
): Promise<TableRow | null> {
  // Get existing row
  const existingRow = await getRowById(data.tableId, data.rowId, data.workspaceId)
  if (!existingRow) {
    throw new Error('Row not found')
  }

  // Merge partial update with existing row data so callers can pass only changed fields
  const mergedData = {
    ...(existingRow.data as RowData),
    ...data.data,
  }
  // Auto-clear exec records for workflow output columns the user just wiped
  // AND for downstream groups whose deps just changed. Surfaces the in-flight
  // downstream groups so the caller can cancel + re-run them.
  const { executionsPatch: effectiveExecutionsPatch, inFlightDownstreamGroups } =
    deriveExecClearsForDataPatch(
      data.data,
      table.schema,
      existingRow.executions,
      data.executionsPatch,
      mergedData
    )
  const mergedExecutions = applyExecutionsPatch(existingRow.executions, effectiveExecutionsPatch)

  // Validate size
  const sizeValidation = validateRowSize(mergedData)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  // Validate against schema
  const schemaValidation = coerceRowToSchema(mergedData, table.schema)
  if (!schemaValidation.valid) {
    throw new Error(`Schema validation failed: ${schemaValidation.errors.join(', ')}`)
  }

  // Check unique constraints using optimized database query
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueValidation = await checkUniqueConstraintsDb(
      data.tableId,
      mergedData,
      table.schema,
      data.rowId // Exclude current row
    )
    if (!uniqueValidation.valid) {
      throw new Error(uniqueValidation.errors.join(', '))
    }
  }

  const now = new Date()

  // Cell-task partial writes pass `cancellationGuard` so the upsert into
  // `tableRowExecutions` is a no-op when (a) a stop click already wrote
  // `cancelled` for this run, or (b) a newer run has taken over the cell
  // with a different executionId. Authoritative cancel writes from
  // `cancelWorkflowGroupRuns` skip the guard entirely. Data + executions
  // commit in one transaction so a partial write can't leave the sidecar
  // and the row out of sync.
  const guard = data.cancellationGuard
  const guardRejected = await db
    .transaction(async (trx) => {
      await trx
        .update(userTableRows)
        .set({ data: mergedData, updatedAt: now })
        .where(eq(userTableRows.id, data.rowId))

      const result = await writeExecutionsPatch(
        trx,
        data.tableId,
        data.rowId,
        effectiveExecutionsPatch,
        guard
      )
      if (result === 'guard-rejected') {
        // Roll back the data update too — the worker isn't authoritative.
        throw new GuardRejected()
      }
      return false
    })
    .catch((err) => {
      if (err instanceof GuardRejected) return true
      throw err
    })

  if (guardRejected) {
    return null
  }

  logger.info(`[${requestId}] Updated row ${data.rowId} in table ${data.tableId}`)

  const updatedRow: TableRow = {
    id: data.rowId,
    data: mergedData,
    executions: mergedExecutions,
    position: existingRow.position,
    createdAt: existingRow.createdAt,
    updatedAt: now,
  }

  const oldRows = new Map([[data.rowId, existingRow.data as RowData]])
  void fireTableTrigger(
    data.tableId,
    table.name,
    'update',
    [updatedRow],
    oldRows,
    table.schema,
    requestId
  )

  // Auto-fire only on user-facing data edits. Internal callers that mutate
  // executions (cell-task partial/terminal writes, cancel writes) always pass
  // `executionsPatch` — re-dispatching from those would recursively spawn new
  // dispatches for every running/terminal write, flooding the dispatcher with
  // redundant pre-stamps that strand `pending` cells.
  const isInternalExecWrite = data.executionsPatch && Object.keys(data.executionsPatch).length > 0
  if (isInternalExecWrite) {
    return updatedRow
  }

  // Two passes:
  //  1. Cancel in-flight downstream groups whose dep just changed, then
  //     manually re-run them — the cancel writes `cancelled` per cell and
  //     `mode: 'incomplete' + isManualRun: true` wipes those entries and
  //     re-enqueues.
  //  2. `mode: 'new'` for groups that just had their exec entries cleared
  //     (own-output wipe OR terminal downstream dep-changed) — the
  //     dispatcher's `jsonb_exists_all` SQL filter lets the row through
  //     because at least one targeted group's exec is now missing.
  if (inFlightDownstreamGroups.length > 0) {
    void (async () => {
      try {
        await cancelWorkflowGroupRuns(data.tableId, data.rowId, {
          groupIds: inFlightDownstreamGroups,
        })
        await runWorkflowColumn({
          tableId: data.tableId,
          workspaceId: data.workspaceId,
          mode: 'incomplete',
          isManualRun: true,
          rowIds: [data.rowId],
          groupIds: inFlightDownstreamGroups,
          requestId,
          triggeredByUserId: data.actorUserId,
        })
      } catch (err) {
        logger.error(`[${requestId}] cancel+rerun for in-flight downstream groups failed:`, err)
      }
    })()
  }
  void runWorkflowColumn({
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    rowIds: [data.rowId],
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: data.actorUserId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (updateRow) failed:`, err))

  return updatedRow
}

/**
 * Deletes a single row (hard delete).
 *
 * @param tableId - Table ID
 * @param rowId - Row ID to delete
 * @param workspaceId - Workspace ID for access control
 * @param requestId - Request ID for logging
 * @throws Error if row not found
 */
export async function deleteRow(
  tableId: string,
  rowId: string,
  workspaceId: string,
  requestId: string
): Promise<void> {
  const deleted = await deleteOrderedRow({ tableId, rowId, workspaceId })
  if (!deleted) throw new Error('Row not found')

  logger.info(`[${requestId}] Deleted row ${rowId} from table ${tableId}`)
}

/**
 * Updates multiple rows matching a filter.
 *
 * @param table - Table definition (provides column schema for type-aware filter casts)
 * @param data - Bulk update data
 * @param requestId - Request ID for logging
 * @returns Bulk operation result
 */
export async function updateRowsByFilter(
  table: TableDefinition,
  data: BulkUpdateData,
  requestId: string
): Promise<BulkOperationResult> {
  const tableName = USER_TABLE_ROWS_SQL_NAME

  const filterClause = buildFilterClause(data.filter, tableName, table.schema.columns)
  if (!filterClause) {
    throw new Error('Filter is required for bulk update')
  }

  const baseConditions = and(
    eq(userTableRows.tableId, table.id),
    eq(userTableRows.workspaceId, table.workspaceId)
  )

  // Tenant-bounded: the jsonb filter is unestimatable and otherwise sends the planner to a
  // whole-shared-relation seq scan (14.4s measured on a 1M-row table).
  const matchingRows = await withSeqscanOff(async (trx) => {
    let query = trx
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(and(baseConditions, filterClause))
    if (data.limit) {
      query = query.limit(data.limit) as typeof query
    }
    return query
  })

  if (matchingRows.length === 0) {
    return { affectedCount: 0, affectedRowIds: [] }
  }

  // Coerce the patch itself in place — the write below persists `data.data`
  // (as `patchJson`), so coercing only the per-row merged copies would be
  // discarded. The merged validation in the loop still enforces required
  // fields against the full row.
  coerceRowValues(data.data, table.schema)

  for (const row of matchingRows) {
    const existingData = row.data as RowData
    const mergedData = { ...existingData, ...data.data }

    const sizeValidation = validateRowSize(mergedData)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${row.id}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = coerceRowToSchema(mergedData, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${row.id}: ${schemaValidation.errors.join(', ')}`)
    }
  }

  const uniqueColumns = getUniqueColumns(table.schema)
  const uniqueColumnsInUpdate = uniqueColumns.filter((col) => col.name in data.data)
  if (uniqueColumnsInUpdate.length > 0) {
    if (matchingRows.length > 1) {
      throw new Error(
        `Cannot set unique column values when updating multiple rows. ` +
          `Columns with unique constraint: ${uniqueColumnsInUpdate.map((c) => c.name).join(', ')}. ` +
          `Updating ${matchingRows.length} rows with the same value would violate uniqueness.`
      )
    }

    // Only one row — only the touched unique columns need re-checking.
    const row = matchingRows[0]
    const mergedData = { ...(row.data as RowData), ...data.data }
    const uniqueValidation = await checkUniqueConstraintsDb(
      table.id,
      mergedData,
      table.schema,
      row.id
    )
    if (!uniqueValidation.valid) {
      throw new Error(`Unique constraint violation: ${uniqueValidation.errors.join(', ')}`)
    }
  }

  const now = new Date()
  const ids = matchingRows.map((r) => r.id)
  const patchJson = JSON.stringify(data.data)

  await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    for (let i = 0; i < ids.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
      const batchIds = ids.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
      await trx
        .update(userTableRows)
        .set({
          data: sql`${userTableRows.data} || ${patchJson}::jsonb`,
          updatedAt: now,
        })
        .where(inArray(userTableRows.id, batchIds))
    }
  })

  logger.info(`[${requestId}] Updated ${matchingRows.length} rows in table ${table.id}`)

  const oldRows = new Map(matchingRows.map((r) => [r.id, r.data as RowData]))
  const updatedRows: TableRow[] = matchingRows.map((r) => ({
    id: r.id,
    data: { ...(r.data as RowData), ...data.data },
    executions: {},
    position: 0,
    createdAt: now,
    updatedAt: now,
  }))
  void fireTableTrigger(
    table.id,
    table.name,
    'update',
    updatedRows,
    oldRows,
    table.schema,
    requestId
  )
  void runWorkflowColumn({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds: updatedRows.map((r) => r.id),
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: data.actorUserId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (updateRowsByFilter) failed:`, err))

  return {
    affectedCount: matchingRows.length,
    affectedRowIds: ids,
  }
}

/**
 * Updates multiple rows with per-row data in a single transaction.
 * Avoids the race condition of parallel update_row calls overwriting each other.
 */
export async function batchUpdateRows(
  data: BatchUpdateByIdData,
  table: TableDefinition,
  requestId: string
): Promise<BulkOperationResult> {
  if (data.updates.length === 0) {
    return { affectedCount: 0, affectedRowIds: [] }
  }

  const rowIds = data.updates.map((u) => u.rowId)
  const existingRows = await db
    .select({
      id: userTableRows.id,
      data: userTableRows.data,
    })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, data.tableId),
        eq(userTableRows.workspaceId, data.workspaceId),
        inArray(userTableRows.id, rowIds)
      )
    )

  const executionsByRow = await loadExecutionsByRow(
    db,
    existingRows.map((r) => r.id)
  )

  type ExistingRow = { data: RowData; executions: RowExecutions }
  const existingMap = new Map<string, ExistingRow>(
    existingRows.map((r) => [
      r.id,
      { data: r.data as RowData, executions: executionsByRow.get(r.id) ?? {} },
    ])
  )

  const missing = rowIds.filter((id) => !existingMap.has(id))
  if (missing.length > 0) {
    throw new Error(`Rows not found: ${missing.join(', ')}`)
  }

  const mergedUpdates: Array<{
    rowId: string
    mergedData: RowData
    mergedExecutions: RowExecutions
    executionsPatch?: Record<string, RowExecutionMetadata | null>
    inFlightDownstreamGroups: string[]
  }> = []
  for (const update of data.updates) {
    const existing = existingMap.get(update.rowId)!
    const merged = { ...existing.data, ...update.data }
    // Auto-clear exec records for workflow output columns the user just
    // wiped AND downstream dep-changed terminal groups — same rationale as
    // `updateRow`. Per-row in-flight downstream groups are surfaced so we
    // can run the cancel+rerun orchestration after the batch commits.
    const { executionsPatch: effectiveExecutionsPatch, inFlightDownstreamGroups } =
      deriveExecClearsForDataPatch(
        update.data,
        table.schema,
        existing.executions,
        update.executionsPatch,
        merged
      )
    const mergedExecutions = applyExecutionsPatch(existing.executions, effectiveExecutionsPatch)

    const sizeValidation = validateRowSize(merged)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = coerceRowToSchema(merged, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${schemaValidation.errors.join(', ')}`)
    }

    mergedUpdates.push({
      rowId: update.rowId,
      mergedData: merged,
      mergedExecutions,
      executionsPatch: effectiveExecutionsPatch,
      inFlightDownstreamGroups,
    })
  }

  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    for (const { rowId, mergedData } of mergedUpdates) {
      const uniqueValidation = await checkUniqueConstraintsDb(
        data.tableId,
        mergedData,
        table.schema,
        rowId
      )
      if (!uniqueValidation.valid) {
        throw new Error(`Row ${rowId}: ${uniqueValidation.errors.join(', ')}`)
      }
    }
  }

  const now = new Date()

  await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    for (let i = 0; i < mergedUpdates.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
      const batch = mergedUpdates.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
      // Update row data in parallel; sidecar exec writes are sequential per
      // row (each goes through writeExecutionsPatch's per-key upsert).
      const dataPromises = batch.map(({ rowId, mergedData }) =>
        trx
          .update(userTableRows)
          .set({ data: mergedData, updatedAt: now })
          .where(eq(userTableRows.id, rowId))
      )
      await Promise.all(dataPromises)
      for (const { rowId, executionsPatch } of batch) {
        await writeExecutionsPatch(trx, data.tableId, rowId, executionsPatch)
      }
    }
  })

  logger.info(`[${requestId}] Batch updated ${mergedUpdates.length} rows in table ${data.tableId}`)

  const oldRowsForTrigger = new Map(
    data.updates.map((u) => [u.rowId, existingMap.get(u.rowId)!.data])
  )
  const updatedRowsForTrigger: TableRow[] = mergedUpdates.map(
    ({ rowId, mergedData, mergedExecutions }) => ({
      id: rowId,
      data: mergedData,
      executions: mergedExecutions,
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
  )
  void fireTableTrigger(
    data.tableId,
    table.name,
    'update',
    updatedRowsForTrigger,
    oldRowsForTrigger,
    table.schema,
    requestId
  )
  // Per-row cancel+rerun for in-flight downstream groups whose deps just
  // changed — same orchestration as single-row `updateRow`. Without this,
  // batch updates would leave running workflows reading stale dep values.
  // Each row needs its own cancel + manual-incomplete dispatch because
  // `cancelWorkflowGroupRuns`'s `groupIds` filter is per-row.
  const rowsWithInFlightDownstream = mergedUpdates.filter(
    (u) => u.inFlightDownstreamGroups.length > 0
  )
  if (rowsWithInFlightDownstream.length > 0) {
    void (async () => {
      try {
        for (const { rowId, inFlightDownstreamGroups } of rowsWithInFlightDownstream) {
          await cancelWorkflowGroupRuns(data.tableId, rowId, {
            groupIds: inFlightDownstreamGroups,
          })
          await runWorkflowColumn({
            tableId: data.tableId,
            workspaceId: data.workspaceId,
            mode: 'incomplete',
            isManualRun: true,
            rowIds: [rowId],
            groupIds: inFlightDownstreamGroups,
            requestId,
            triggeredByUserId: data.actorUserId,
          })
        }
      } catch (err) {
        logger.error(
          `[${requestId}] cancel+rerun for in-flight downstream groups (batch) failed:`,
          err
        )
      }
    })()
  }
  void runWorkflowColumn({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds: updatedRowsForTrigger.map((r) => r.id),
    mode: 'new',
    isManualRun: false,
    requestId,
    triggeredByUserId: data.actorUserId,
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (batchUpdateRows) failed:`, err))

  return {
    affectedCount: mergedUpdates.length,
    affectedRowIds: mergedUpdates.map((u) => u.rowId),
  }
}

/**
 * Deletes multiple rows matching a filter.
 *
 * @param table - Table definition (provides column schema for type-aware filter casts)
 * @param data - Bulk delete data
 * @param requestId - Request ID for logging
 * @returns Bulk operation result
 */
export async function deleteRowsByFilter(
  table: TableDefinition,
  data: BulkDeleteData,
  requestId: string
): Promise<BulkOperationResult> {
  const tableName = USER_TABLE_ROWS_SQL_NAME

  // Build filter clause
  const filterClause = buildFilterClause(data.filter, tableName, table.schema.columns)
  if (!filterClause) {
    throw new Error('Filter is required for bulk delete')
  }

  // Find matching rows
  const baseConditions = and(
    eq(userTableRows.tableId, table.id),
    eq(userTableRows.workspaceId, table.workspaceId)
  )

  // Tenant-bounded for the same reason as updateRowsByFilter — see withSeqscanOff.
  const matchingRows = await withSeqscanOff(async (trx) => {
    let query = trx
      .select({ id: userTableRows.id, position: userTableRows.position })
      .from(userTableRows)
      .where(and(baseConditions, filterClause))
    if (data.limit) {
      query = query.limit(data.limit) as typeof query
    }
    return query
  })

  if (matchingRows.length === 0) {
    return { affectedCount: 0, affectedRowIds: [] }
  }

  const rowIds = matchingRows.map((r) => r.id)

  await deleteOrderedRowsByIds({
    tableId: table.id,
    workspaceId: table.workspaceId,
    rowIds,
  })

  logger.info(`[${requestId}] Deleted ${matchingRows.length} rows from table ${table.id}`)

  return {
    affectedCount: matchingRows.length,
    affectedRowIds: rowIds,
  }
}

/**
 * Deletes rows by their IDs.
 *
 * @param data - Row IDs and table context
 * @param requestId - Request ID for logging
 * @returns Deletion result with deleted/missing row IDs
 */
export async function deleteRowsByIds(
  data: BulkDeleteByIdsData,
  requestId: string
): Promise<BulkDeleteByIdsResult> {
  const uniqueRequestedRowIds = Array.from(new Set(data.rowIds))

  const deletedRows = await deleteOrderedRowsByIds({
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    rowIds: uniqueRequestedRowIds,
  })

  const deletedIds = deletedRows.map((r) => r.id)
  const deletedIdSet = new Set(deletedIds)
  const missingRowIds = uniqueRequestedRowIds.filter((id) => !deletedIdSet.has(id))

  logger.info(`[${requestId}] Deleted ${deletedIds.length} rows by ID from table ${data.tableId}`)

  return {
    deletedCount: deletedIds.length,
    deletedRowIds: deletedIds,
    requestedCount: uniqueRequestedRowIds.length,
    missingRowIds,
  }
}
