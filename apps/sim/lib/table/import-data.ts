/**
 * Import-job table-data write operations — bulk insert, schema setup, and
 * append/replace used by `import-runner.ts` and the import route. Distinct from
 * `import.ts` (CSV parsing) and `import-runner.ts` (the job runner).
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { assertRowCapacity, notifyTableRowUsage } from '@/lib/table/billing'
import { CSV_MAX_BATCH_SIZE } from '@/lib/table/import'
import { nKeysBetween } from '@/lib/table/order-key'
import { acquireRowOrderLock } from '@/lib/table/rows/ordering'
import { batchInsertRowsWithTx, replaceTableRowsWithTx } from '@/lib/table/rows/service'
import { addTableColumnsWithTx, auditTableColumnsAdded } from '@/lib/table/service'
import type {
  ReplaceRowsResult,
  RowData,
  TableDefinition,
  TableRow,
  TableSchema,
} from '@/lib/table/types'
import {
  checkBatchUniqueConstraintsDb,
  coerceRowToSchema,
  getUniqueColumns,
  validateRowSize,
} from '@/lib/table/validation'

const logger = createLogger('TableImportData')

/** One batch of rows for a background import (see {@link bulkInsertImportBatch}). */
export interface BulkImportBatch {
  tableId: string
  workspaceId: string
  userId?: string
  rows: RowData[]
  /** Position of the first row in this batch; rows get contiguous positions from here. */
  startPosition: number
  /** Previous batch's last `order_key` (the append anchor); null for the first batch / empty table. */
  afterOrderKey?: string | null
}

/**
 * Inserts one batch of rows for an async import in a single committed statement.
 *
 * Differs from {@link batchInsertRowsWithTx} for the bulk-load case: caller-supplied
 * contiguous positions (no `acquireTablePositionLock` / `nextAutoPosition` scan — an
 * import owns its hidden table as the sole writer), no `RETURNING`, and **no
 * `fireTableTrigger` / `runWorkflowColumn`** (a 1M-row import must not dispatch a
 * workflow run per row). `row_count` is maintained set-based by the statement-level
 * trigger. There is no surrounding transaction and no rollback: each batch commits on
 * its own, so committed batches persist even if a later batch fails.
 *
 * Throws on row-size/schema/unique violations or if the statement-level trigger rejects
 * the batch for crossing `max_rows`; the caller marks the import failed.
 */
export async function bulkInsertImportBatch(
  data: BulkImportBatch,
  table: TableDefinition,
  requestId: string
): Promise<{ inserted: number; lastOrderKey: string | null }> {
  for (let i = 0; i < data.rows.length; i++) {
    const sizeValidation = validateRowSize(data.rows[i])
    if (!sizeValidation.valid) {
      throw new Error(`Row ${i + 1}: ${sizeValidation.errors.join(', ')}`)
    }
    const schemaValidation = coerceRowToSchema(data.rows[i], table.schema)
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
      db
    )
    if (!uniqueResult.valid) {
      throw new Error(
        uniqueResult.errors.map((e) => `Row ${e.row + 1}: ${e.errors.join(', ')}`).join('; ')
      )
    }
  }

  const now = new Date()
  // Import worker is the table's sole writer; append keys after the anchor the caller threads
  // from the previous batch's last key — no per-batch max(order_key) scan over a growing table.
  const orderKeys = nKeysBetween(data.afterOrderKey ?? null, null, data.rows.length)
  const rowsToInsert = data.rows.map((rowData, i) => ({
    id: `row_${generateId().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    position: data.startPosition + i,
    orderKey: orderKeys[i],
    createdAt: now,
    updatedAt: now,
    ...(data.userId ? { createdBy: data.userId } : {}),
  }))

  await db.insert(userTableRows).values(rowsToInsert)
  logger.info(`[${requestId}] Bulk-imported ${rowsToInsert.length} rows into table ${data.tableId}`)
  return {
    inserted: rowsToInsert.length,
    lastOrderKey: orderKeys[orderKeys.length - 1] ?? data.afterOrderKey ?? null,
  }
}

/** Deletes every row of a table (set-based; the statement-level trigger zeroes `row_count`). */
export async function deleteAllTableRows(tableId: string): Promise<void> {
  await db.delete(userTableRows).where(eq(userTableRows.tableId, tableId))
}

/**
 * Adds columns to a table during an import (the `createColumns` flow), wrapping the
 * tx-bound {@link addTableColumnsWithTx} in its own transaction. Returns the updated table.
 */
export async function addImportColumns(
  table: TableDefinition,
  additions: { name: string; type: string }[],
  requestId: string,
  actingUserId?: string
): Promise<TableDefinition> {
  const updated = await db.transaction((trx) =>
    addTableColumnsWithTx(trx, table, additions, requestId)
  )
  auditTableColumnsAdded(
    table,
    additions.map((c) => c.name),
    actingUserId
  )
  return updated
}

/** Overwrites a table's schema during an import (used when inferring columns from the file). */
export async function setTableSchemaForImport(tableId: string, schema: TableSchema): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ schema, updatedAt: new Date() })
    .where(eq(userTableDefinitions.id, tableId))
}

/**
 * Owns the append-import transaction so the API route never holds a `trx`:
 * optionally creates the new columns, then inserts every row in CSV-sized
 * batches — all atomic. Caller fires {@link dispatchAfterBatchInsert} after this
 * resolves (post-commit), mirroring the other batch-insert sites.
 */
export async function importAppendRows(
  table: TableDefinition,
  additions: { id?: string; name: string; type: string; required?: boolean; unique?: boolean }[],
  rows: RowData[],
  ctx: { workspaceId: string; userId?: string; requestId: string }
): Promise<{ inserted: TableRow[]; table: TableDefinition }> {
  // Gate capacity before opening the tx — the lookup is a separate pool read.
  const rowLimit = await assertRowCapacity({
    workspaceId: ctx.workspaceId,
    currentRowCount: table.rowCount,
    addedRows: rows.length,
  })
  const result = await db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
      // Take the row-order lock before creating columns so this path uses the
      // same rows_pos → user_table_definitions order as plain inserts. Creating
      // columns first would lock the definition row before rows_pos, inverting
      // the order and deadlocking concurrent inserts on this table. The lock is
      // re-entrant, so the per-batch acquire below is a no-op.
      await acquireRowOrderLock(trx, table.id)
      working = await addTableColumnsWithTx(trx, table, additions, ctx.requestId)
    }
    const inserted: TableRow[] = []
    for (let i = 0; i < rows.length; i += CSV_MAX_BATCH_SIZE) {
      const batch = rows.slice(i, i + CSV_MAX_BATCH_SIZE)
      const batchInserted = await batchInsertRowsWithTx(
        trx,
        { tableId: working.id, rows: batch, workspaceId: ctx.workspaceId, userId: ctx.userId },
        working,
        generateId().slice(0, 8)
      )
      inserted.push(...batchInserted)
    }
    return { inserted, table: working }
  })
  // Audit post-commit — a mid-import rollback means the columns weren't added.
  if (additions.length > 0) {
    auditTableColumnsAdded(
      table,
      additions.map((c) => c.name),
      ctx.userId
    )
  }
  notifyTableRowUsage({
    workspaceId: ctx.workspaceId,
    currentRowCount: table.rowCount,
    addedRows: result.inserted.length,
    limit: rowLimit,
  })
  return result
}

/**
 * Owns the replace-import transaction: optionally creates the new columns, then
 * replaces all rows — atomically. Keeps `trx` out of the API route.
 */
export async function importReplaceRows(
  table: TableDefinition,
  additions: { id?: string; name: string; type: string; required?: boolean; unique?: boolean }[],
  data: { rows: RowData[]; workspaceId: string; userId?: string },
  requestId: string
): Promise<ReplaceRowsResult> {
  // Replace deletes all existing rows, so the footprint is just the new set. Gate
  // before opening the tx — the plan lookup is a separate pool read.
  const rowLimit = await assertRowCapacity({
    workspaceId: data.workspaceId,
    currentRowCount: 0,
    addedRows: data.rows.length,
  })
  const result = await db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
      await acquireRowOrderLock(trx, table.id)
      working = await addTableColumnsWithTx(trx, table, additions, requestId)
    }
    return replaceTableRowsWithTx(
      trx,
      { tableId: working.id, rows: data.rows, workspaceId: data.workspaceId, userId: data.userId },
      working,
      requestId
    )
  })
  // Audit post-commit (see importAppendRows).
  if (additions.length > 0) {
    auditTableColumnsAdded(
      table,
      additions.map((c) => c.name),
      data.userId
    )
  }
  notifyTableRowUsage({
    workspaceId: data.workspaceId,
    currentRowCount: 0,
    addedRows: result.insertedCount,
    limit: rowLimit,
  })
  return result
}
