/**
 * Table service layer for internal programmatic access.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Note: API routes have their own implementations for HTTP-specific concerns.
 */

import { db } from '@sim/db'
import {
  tableRowExecutions,
  userTableDefinitions,
  userTableRows,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { isTablesFractionalOrderingEnabled } from '@/lib/core/config/feature-flags'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbOrTx } from '@/lib/db/types'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from './constants'
import { areGroupDepsSatisfied } from './deps'
import { CSV_MAX_BATCH_SIZE } from './import'
import { keyBetween, nKeysBetween } from './order-key'
import { buildFilterClause, buildSortClause } from './sql'
import { fireTableTrigger } from './trigger'
import type {
  AddWorkflowGroupData,
  BatchInsertData,
  BatchUpdateByIdData,
  BulkDeleteByIdsData,
  BulkDeleteByIdsResult,
  BulkDeleteData,
  BulkOperationResult,
  BulkUpdateData,
  ColumnDefinition,
  CreateTableData,
  DeleteColumnData,
  DeleteWorkflowGroupData,
  InsertRowData,
  QueryOptions,
  QueryResult,
  RenameColumnData,
  ReplaceRowsData,
  ReplaceRowsResult,
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  TableDefinition,
  TableMetadata,
  TableRow,
  TableSchema,
  UpdateColumnConstraintsData,
  UpdateColumnTypeData,
  UpdateRowData,
  UpdateWorkflowGroupData,
  UpsertResult,
  UpsertRowData,
  WorkflowGroup,
  WorkflowGroupOutput,
} from './types'
import {
  checkBatchUniqueConstraintsDb,
  checkUniqueConstraintsDb,
  coerceRowToSchema,
  coerceRowValues,
  getUniqueColumns,
  validateRowSize,
  validateTableName,
  validateTableSchema,
} from './validation'
import {
  assertValidSchema,
  cancelWorkflowGroupRuns,
  runWorkflowColumn,
  stripGroupDeps,
} from './workflow-columns'

const logger = createLogger('TableService')

export class TableConflictError extends Error {
  readonly code = 'TABLE_EXISTS' as const
  constructor(name: string) {
    super(`A table named "${name}" already exists in this workspace`)
  }
}

export type TableScope = 'active' | 'archived' | 'all'

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Sets per-transaction Postgres timeouts via `SET LOCAL`.
 *
 * `lock_timeout` is the critical one: without it, a waiter inherits the full
 * `statement_timeout` clock, so one stuck writer can drain the pool.
 *
 * Safe under pgBouncer transaction pooling — `SET LOCAL` is transaction-scoped
 * and cleared at COMMIT/ROLLBACK before the session returns to the pool.
 */
async function setTableTxTimeouts(
  trx: DbTransaction,
  opts?: { statementMs?: number; lockMs?: number; idleMs?: number }
) {
  const s = opts?.statementMs ?? 10_000
  const l = opts?.lockMs ?? 3_000
  const i = opts?.idleMs ?? 5_000
  await trx.execute(sql.raw(`SET LOCAL statement_timeout = '${s}ms'`))
  await trx.execute(sql.raw(`SET LOCAL lock_timeout = '${l}ms'`))
  await trx.execute(sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${i}ms'`))
}

/**
 * Serializes schema/metadata read-modify-writes for a single table so
 * concurrent mutators can't clobber each other's `schema` JSONB
 * (last-writer-wins). Takes a transaction-scoped advisory lock keyed on
 * `tableId`, then re-reads the table INSIDE the lock and hands the fresh
 * definition + transaction to `mutate`. Each serialized writer therefore
 * validates and computes against the prior writer's committed columns.
 *
 * Uses an advisory lock (not `SELECT ... FOR UPDATE` on the definition row) so
 * it adds no edges to the row-lock graph — the row-count trigger (migration
 * 0198) locks the definition row from `insertRow`/`deleteRow`, and a FOR UPDATE
 * here would invert that order. Mirrors `acquireTablePositionLock`. The lock and
 * the read both release at COMMIT/ROLLBACK; the wait is bounded by the
 * `statement_timeout` set in `setTableTxTimeouts`.
 */
async function withLockedTable<T>(
  tableId: string,
  mutate: (table: TableDefinition, trx: DbTransaction) => Promise<T>,
  opts?: { includeArchived?: boolean }
): Promise<T> {
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await trx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${tableId}`}, 0))`
    )
    const table = await getTableById(tableId, { tx: trx, includeArchived: opts?.includeArchived })
    if (!table) {
      throw new Error('Table not found')
    }
    return mutate(table, trx)
  })
}

/**
 * Starting `position` for an append import — `max(position) + 1`, or 0 when empty. Read once,
 * unlocked, before streaming: the import worker is the table's sole writer, so it can assign
 * contiguous positions from this offset without per-batch position scans.
 */
export async function nextImportStartPosition(tableId: string): Promise<number> {
  const [{ maxPos }] = await db
    .select({
      maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
    })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxPos + 1
}

/**
 * Append anchor `order_key` for an import — `max(order_key)`, or null when empty. Read once,
 * unlocked, before streaming (the import worker is the table's sole writer); each batch threads
 * the previous batch's last key forward so no per-batch max scan is needed.
 */
export async function nextImportStartOrderKey(tableId: string): Promise<string | null> {
  return maxOrderKey(db, tableId)
}

const TIMEOUT_CAP_MS = 10 * 60_000

/**
 * Scales `statement_timeout` to the expected row-count work.
 *
 * Bulk operations that rewrite JSONB or cascade row triggers (e.g.
 * `replaceTableRows`, `deleteColumn`, `renameColumn`) scale roughly linearly
 * with row count. A fixed cap would regress large-table users who never saw a
 * timeout before `SET LOCAL` was introduced. This helper picks
 * `max(baseMs, rowCount * perRowMs)`, capped at 10 minutes so a single
 * runaway transaction cannot indefinitely pin a pool connection.
 */
function scaledStatementTimeoutMs(
  rowCount: number,
  opts: { baseMs: number; perRowMs: number }
): number {
  const safeRowCount = Math.max(0, rowCount)
  return Math.min(TIMEOUT_CAP_MS, Math.max(opts.baseMs, safeRowCount * opts.perRowMs))
}

/**
 * Gets a table by ID with full details.
 *
 * @param tableId - Table ID to fetch
 * @returns Table definition or null if not found
 */
/**
 * Returns `schema` with `columns` sorted by `metadata.columnOrder` (the user-
 * editable visible order). Columns missing from `columnOrder` are appended at
 * the end in their original (schema-creation) order — covers tables created
 * before `columnOrder` existed and any drift from out-of-band column adds.
 *
 * This makes `schema.columns` the single source of truth for column order on
 * the wire. The client doesn't have to join the two arrays itself — every
 * consumer (grid, sidebar, copilot, mothership) gets the same ordered list.
 */
function applyColumnOrderToSchema(
  schema: TableSchema,
  metadata: TableMetadata | null
): TableSchema {
  const order = metadata?.columnOrder
  if (!order || order.length === 0) return schema
  const byName = new Map<string, TableSchema['columns'][number]>()
  for (const c of schema.columns) byName.set(c.name, c)
  const ordered: TableSchema['columns'] = []
  for (const name of order) {
    const c = byName.get(name)
    if (c) {
      ordered.push(c)
      byName.delete(name)
    }
  }
  for (const c of byName.values()) ordered.push(c)
  return { ...schema, columns: ordered }
}

export async function getTableById(
  tableId: string,
  options?: { includeArchived?: boolean; tx?: DbOrTx }
): Promise<TableDefinition | null> {
  const { includeArchived = false, tx } = options ?? {}
  const executor = tx ?? db
  const results = await executor
    .select({
      id: userTableDefinitions.id,
      name: userTableDefinitions.name,
      description: userTableDefinitions.description,
      schema: userTableDefinitions.schema,
      metadata: userTableDefinitions.metadata,
      maxRows: userTableDefinitions.maxRows,
      workspaceId: userTableDefinitions.workspaceId,
      createdBy: userTableDefinitions.createdBy,
      archivedAt: userTableDefinitions.archivedAt,
      createdAt: userTableDefinitions.createdAt,
      updatedAt: userTableDefinitions.updatedAt,
      rowCount: userTableDefinitions.rowCount,
      importStatus: userTableDefinitions.importStatus,
      importId: userTableDefinitions.importId,
      importError: userTableDefinitions.importError,
      importRowsProcessed: userTableDefinitions.importRowsProcessed,
      importStartedAt: userTableDefinitions.importStartedAt,
    })
    .from(userTableDefinitions)
    .where(
      includeArchived
        ? eq(userTableDefinitions.id, tableId)
        : and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.archivedAt))
    )
    .limit(1)

  if (results.length === 0) return null

  const table = results[0]
  const metadata = (table.metadata as TableMetadata) ?? null
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: applyColumnOrderToSchema(table.schema as TableSchema, metadata),
    metadata,
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
    createdBy: table.createdBy,
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    importStatus: table.importStatus as TableDefinition['importStatus'],
    importId: table.importId,
    importError: table.importError,
    importRowsProcessed: table.importRowsProcessed,
    importStartedAt: table.importStartedAt,
  }
}

/**
 * Lists all tables in a workspace.
 *
 * @param workspaceId - Workspace ID to list tables for
 * @returns Array of table definitions
 */
async function countTables(workspaceId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )
  return result.count
}

export async function listTables(
  workspaceId: string,
  options?: { scope?: TableScope }
): Promise<TableDefinition[]> {
  const { scope = 'active' } = options ?? {}
  const tables = await db
    .select({
      id: userTableDefinitions.id,
      name: userTableDefinitions.name,
      description: userTableDefinitions.description,
      schema: userTableDefinitions.schema,
      metadata: userTableDefinitions.metadata,
      maxRows: userTableDefinitions.maxRows,
      workspaceId: userTableDefinitions.workspaceId,
      createdBy: userTableDefinitions.createdBy,
      archivedAt: userTableDefinitions.archivedAt,
      createdAt: userTableDefinitions.createdAt,
      updatedAt: userTableDefinitions.updatedAt,
      rowCount: userTableDefinitions.rowCount,
      importStatus: userTableDefinitions.importStatus,
      importId: userTableDefinitions.importId,
      importError: userTableDefinitions.importError,
      importRowsProcessed: userTableDefinitions.importRowsProcessed,
      importStartedAt: userTableDefinitions.importStartedAt,
    })
    .from(userTableDefinitions)
    .where(
      scope === 'all'
        ? eq(userTableDefinitions.workspaceId, workspaceId)
        : scope === 'archived'
          ? and(
              eq(userTableDefinitions.workspaceId, workspaceId),
              sql`${userTableDefinitions.archivedAt} IS NOT NULL`
            )
          : and(
              eq(userTableDefinitions.workspaceId, workspaceId),
              isNull(userTableDefinitions.archivedAt)
            )
    )
    .orderBy(userTableDefinitions.createdAt)

  return tables.map((t) => {
    const metadata = (t.metadata as TableMetadata) ?? null
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      schema: applyColumnOrderToSchema(t.schema as TableSchema, metadata),
      metadata,
      rowCount: t.rowCount,
      maxRows: t.maxRows,
      workspaceId: t.workspaceId,
      createdBy: t.createdBy,
      archivedAt: t.archivedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      importStatus: t.importStatus as TableDefinition['importStatus'],
      importId: t.importId,
      importError: t.importError,
      importRowsProcessed: t.importRowsProcessed,
      importStartedAt: t.importStartedAt,
    }
  })
}

/**
 * Creates a new table.
 *
 * @param data - Table creation data
 * @param requestId - Request ID for logging
 * @returns Created table definition
 * @throws Error if validation fails or limits exceeded
 */
export async function createTable(
  data: CreateTableData,
  requestId: string
): Promise<TableDefinition> {
  // Validate table name
  const nameValidation = validateTableName(data.name)
  if (!nameValidation.valid) {
    throw new Error(`Invalid table name: ${nameValidation.errors.join(', ')}`)
  }

  // Validate schema
  const schemaValidation = validateTableSchema(data.schema)
  if (!schemaValidation.valid) {
    throw new Error(`Invalid schema: ${schemaValidation.errors.join(', ')}`)
  }

  const tableId = `tbl_${generateId().replace(/-/g, '')}`
  const now = new Date()

  // Use provided maxRows (from billing plan) or fall back to default
  const maxRows = data.maxRows ?? TABLE_LIMITS.MAX_ROWS_PER_TABLE
  const maxTables = data.maxTables ?? TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE

  const newTable = {
    id: tableId,
    name: data.name,
    description: data.description ?? null,
    schema: data.schema,
    workspaceId: data.workspaceId,
    createdBy: data.userId,
    maxRows,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    importStatus: data.importStatus ?? null,
    importId: data.importId ?? null,
    importStartedAt: data.importStatus ? now : null,
  }

  // Wrap count check, duplicate check, and insert in a transaction with FOR UPDATE
  // to prevent TOCTOU race on the table count limit
  try {
    await db.transaction(async (trx) => {
      await setTableTxTimeouts(trx)
      await trx.execute(sql`SELECT 1 FROM workspace WHERE id = ${data.workspaceId} FOR UPDATE`)

      const [{ count: existingCount }] = await trx
        .select({ count: count() })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        )

      if (Number(existingCount) >= maxTables) {
        throw new Error(`Workspace has reached maximum table limit (${maxTables})`)
      }

      const duplicateName = await trx
        .select({ id: userTableDefinitions.id })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            eq(userTableDefinitions.name, data.name),
            isNull(userTableDefinitions.archivedAt)
          )
        )
        .limit(1)

      if (duplicateName.length > 0) {
        throw new TableConflictError(data.name)
      }

      await trx.insert(userTableDefinitions).values(newTable)

      const initialRowCount = data.initialRowCount ?? 0
      if (initialRowCount > 0) {
        const orderKeys = nKeysBetween(null, null, initialRowCount)
        const rowsToInsert = Array.from({ length: initialRowCount }, (_, i) => ({
          id: `row_${generateId().replace(/-/g, '')}`,
          tableId,
          data: {},
          position: i,
          orderKey: orderKeys[i],
          workspaceId: data.workspaceId,
          createdAt: now,
          updatedAt: now,
        }))
        await trx.insert(userTableRows).values(rowsToInsert)
      }
    })
  } catch (error: unknown) {
    if (error instanceof TableConflictError) {
      throw error
    }
    if (getPostgresErrorCode(error) === '23505') {
      throw new TableConflictError(data.name)
    }
    throw error
  }

  logger.info(`[${requestId}] Created table ${tableId} in workspace ${data.workspaceId}`)

  return {
    id: newTable.id,
    name: newTable.name,
    description: newTable.description,
    schema: newTable.schema as TableSchema,
    metadata: null,
    rowCount: data.initialRowCount ?? 0,
    maxRows: newTable.maxRows,
    workspaceId: newTable.workspaceId,
    createdBy: newTable.createdBy,
    archivedAt: newTable.archivedAt,
    createdAt: newTable.createdAt,
    updatedAt: newTable.updatedAt,
    importStatus: newTable.importStatus as TableDefinition['importStatus'],
    importId: newTable.importId,
    importRowsProcessed: 0,
    importStartedAt: newTable.importStartedAt,
  }
}

/**
 * Adds a column to an existing table's schema.
 *
 * @param tableId - Table ID to update
 * @param column - Column definition to add
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found or column name already exists
 */
export async function addTableColumn(
  tableId: string,
  column: {
    name: string
    type: string
    required?: boolean
    unique?: boolean
    position?: number
  },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(tableId, async (table, trx) => {
    if (!NAME_PATTERN.test(column.name)) {
      throw new Error(
        `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }

    if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }

    if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
      throw new Error(
        `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
      )
    }

    const schema = table.schema
    if (schema.columns.some((c) => c.name.toLowerCase() === column.name.toLowerCase())) {
      throw new Error(`Column "${column.name}" already exists`)
    }

    if (schema.columns.length >= TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Table has reached maximum column limit (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`
      )
    }

    const newColumn: TableSchema['columns'][number] = {
      name: column.name,
      type: column.type as TableSchema['columns'][number]['type'],
      required: column.required ?? false,
      unique: column.unique ?? false,
    }

    const columns = [...schema.columns]
    if (column.position !== undefined && column.position >= 0 && column.position < columns.length) {
      columns.splice(column.position, 0, newColumn)
    } else {
      columns.push(newColumn)
    }

    const updatedSchema: TableSchema = { ...schema, columns }

    // Keep `metadata.columnOrder` in sync: when present, it must list every
    // column in `schema.columns`. Splicing the new name in at the same index
    // we used in `columns` keeps display ordering aligned with the user's
    // intent for `position`-based inserts.
    const existingOrder = table.metadata?.columnOrder
    let updatedMetadata = table.metadata
    if (existingOrder && existingOrder.length > 0 && !existingOrder.includes(column.name)) {
      let insertIdx = existingOrder.length
      if (column.position !== undefined && column.position >= 0) {
        // Anchor on the column previously at `position` — that column shifted
        // right by one in `columns`, so the new name slots in at its old spot.
        const anchor = schema.columns[column.position]?.name
        if (anchor) {
          const anchorIdx = existingOrder.indexOf(anchor)
          if (anchorIdx !== -1) insertIdx = anchorIdx
        }
      }
      const nextOrder = [...existingOrder]
      nextOrder.splice(insertIdx, 0, column.name)
      updatedMetadata = { ...table.metadata, columnOrder: nextOrder }
    }

    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Added column "${column.name}" to table ${tableId}`)

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })
}

/**
 * Adds multiple columns to an existing table inside a caller-provided
 * transaction. This is atomic with respect to the surrounding `trx`: either
 * all columns are added or none are. Validates each column the same way
 * `addTableColumn` does and rejects if any name collides with an existing
 * column or another entry in `columns`.
 *
 * Use this when composing a column addition with other writes (e.g., row
 * inserts) that must succeed or roll back together.
 */
export async function addTableColumnsWithTx(
  trx: DbTransaction,
  table: TableDefinition,
  columns: { name: string; type: string; required?: boolean; unique?: boolean }[],
  requestId: string
): Promise<TableDefinition> {
  if (columns.length === 0) return table

  const usedNames = new Set(table.schema.columns.map((c) => c.name.toLowerCase()))
  const additions: TableSchema['columns'] = []

  for (const column of columns) {
    if (!NAME_PATTERN.test(column.name)) {
      throw new Error(
        `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }
    if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }
    if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
      throw new Error(
        `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
      )
    }
    const lower = column.name.toLowerCase()
    if (usedNames.has(lower)) {
      throw new Error(`Column "${column.name}" already exists`)
    }
    usedNames.add(lower)
    additions.push({
      name: column.name,
      type: column.type as TableSchema['columns'][number]['type'],
      required: column.required ?? false,
      unique: column.unique ?? false,
    })
  }

  if (table.schema.columns.length + additions.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    throw new Error(
      `Adding ${additions.length} column(s) would exceed maximum column limit (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`
    )
  }

  // Spread `table.schema` first so workflow groups (and any future top-level
  // schema fields) survive a CSV import that only adds plain columns.
  const updatedSchema: TableSchema = {
    ...table.schema,
    columns: [...table.schema.columns, ...additions],
  }
  const now = new Date()

  await trx
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(eq(userTableDefinitions.id, table.id))

  logger.info(
    `[${requestId}] Added ${additions.length} column(s) to table ${table.id}: ${additions.map((c) => c.name).join(', ')}`
  )

  return {
    ...table,
    schema: updatedSchema,
    updatedAt: now,
  }
}

/**
 * Renames a table.
 *
 * @param tableId - Table ID to rename
 * @param newName - New table name
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if name is invalid
 */
export async function renameTable(
  tableId: string,
  newName: string,
  requestId: string
): Promise<{ id: string; name: string }> {
  const nameValidation = validateTableName(newName)
  if (!nameValidation.valid) {
    throw new Error(nameValidation.errors.join(', '))
  }

  const now = new Date()
  try {
    const result = await db
      .update(userTableDefinitions)
      .set({ name: newName, updatedAt: now })
      .where(eq(userTableDefinitions.id, tableId))
      .returning({ id: userTableDefinitions.id })

    if (result.length === 0) {
      throw new Error(`Table ${tableId} not found`)
    }

    logger.info(`[${requestId}] Renamed table ${tableId} to "${newName}"`)
    return { id: tableId, name: newName }
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new TableConflictError(newName)
    }
    throw error
  }
}

/**
 * Updates a table's metadata (UI state like column widths/order, plus behavioral
 * settings like `workflowColumnBatchSize`). Merges into the existing metadata blob.
 *
 * @param tableId - Table ID to update
 * @param metadata - Partial metadata object (merged with existing)
 * @param existingMetadata - Existing metadata from a prior fetch (avoids redundant DB read)
 * @returns Updated metadata
 */
export async function updateTableMetadata(
  tableId: string,
  metadata: TableMetadata,
  existingMetadata?: TableMetadata | null
): Promise<TableMetadata> {
  const merged: TableMetadata = { ...(existingMetadata ?? {}), ...metadata }

  // When `columnOrder` is in the patch, scrub any workflow-group dependency
  // that now sits to the right of (or at the same index as) its group's
  // leftmost column. Without this, reordering a column could leave a group
  // depending on a column it can no longer reach in the dag — the group
  // would never fire.
  const newOrder = metadata.columnOrder
  let nextSchema: TableSchema | null = null
  if (Array.isArray(newOrder) && newOrder.length > 0) {
    const [tableRow] = await db
      .select({ schema: userTableDefinitions.schema })
      .from(userTableDefinitions)
      .where(eq(userTableDefinitions.id, tableId))
      .limit(1)
    if (tableRow) {
      const schema = tableRow.schema as TableSchema
      const groups = schema.workflowGroups ?? []
      if (groups.length > 0) {
        const positionOf = new Map<string, number>()
        newOrder.forEach((name, i) => positionOf.set(name, i))
        let mutated = false
        const nextGroups = groups.map((group) => {
          const ownCols = schema.columns.filter((c) => c.workflowGroupId === group.id)
          let leftmost = Number.POSITIVE_INFINITY
          for (const c of ownCols) {
            const idx = positionOf.get(c.name) ?? Number.POSITIVE_INFINITY
            if (idx < leftmost) leftmost = idx
          }
          if (!Number.isFinite(leftmost)) return group
          const deps = group.dependencies?.columns ?? []
          const removed = new Set(deps.filter((dep) => (positionOf.get(dep) ?? -1) >= leftmost))
          if (removed.size === 0) return group
          const stripped = stripGroupDeps(group, removed)
          if (stripped !== group) mutated = true
          return stripped
        })
        if (mutated) nextSchema = { ...schema, workflowGroups: nextGroups }
      }
    }
  }

  await db
    .update(userTableDefinitions)
    .set(nextSchema ? { metadata: merged, schema: nextSchema } : { metadata: merged })
    .where(eq(userTableDefinitions.id, tableId))

  return merged
}

/**
 * Archives a table.
 *
 * @param tableId - Table ID to delete
 * @param requestId - Request ID for logging
 */
export async function deleteTable(tableId: string, requestId: string): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(userTableDefinitions.id, tableId))

  logger.info(`[${requestId}] Archived table ${tableId}`)
}

/**
 * Drops references to deleted blocks from every workflow group on every table
 * that targets the just-deployed workflow. Called from the workflow deploy
 * orchestrator after the new deployment commits, so the table UI never holds
 * stale `{blockId, path}` entries for blocks the user removed.
 *
 * - Filters `outputs[]` per group. If every output would be filtered out, the
 *   group is left untouched and a warning is logged — the user must
 *   reconfigure it manually.
 * - Scoped to the workflow's workspace.
 * - Idempotent: running twice with the same `validBlockIds` is a no-op on the
 *   second pass. Existing row data is left alone.
 */
export async function pruneStaleWorkflowGroupOutputs({
  workflowId,
  workspaceId,
  validBlockIds,
  requestId,
  tx,
}: {
  workflowId: string
  workspaceId: string
  validBlockIds: Set<string>
  requestId: string
  tx?: DbOrTx
}): Promise<void> {
  const executor = tx ?? db
  const tables = await executor
    .select({
      id: userTableDefinitions.id,
      schema: userTableDefinitions.schema,
    })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )

  for (const t of tables) {
    const schema = t.schema as TableSchema
    const groups = schema.workflowGroups ?? []
    if (groups.length === 0) continue

    let mutated = false
    const nextGroups = groups.map((group) => {
      if (group.workflowId !== workflowId) return group
      const filtered = group.outputs.filter((o) => validBlockIds.has(o.blockId))
      if (filtered.length === group.outputs.length) return group
      if (filtered.length === 0) {
        logger.warn(
          `[${requestId}] All outputs for workflow group "${group.name ?? group.id}" in table ${t.id} reference deleted blocks; leaving group intact for user reconfiguration.`
        )
        return group
      }
      mutated = true
      return { ...group, outputs: filtered }
    })

    if (!mutated) continue

    await executor
      .update(userTableDefinitions)
      .set({
        schema: { ...schema, workflowGroups: nextGroups },
        updatedAt: new Date(),
      })
      .where(eq(userTableDefinitions.id, t.id))

    logger.info(`[${requestId}] Pruned stale workflow=${workflowId} block refs from table ${t.id}`)
  }
}

/**
 * Restores an archived table.
 */
export async function restoreTable(tableId: string, requestId: string): Promise<void> {
  const table = await getTableById(tableId, { includeArchived: true })
  if (!table) {
    throw new Error('Table not found')
  }

  if (!table.archivedAt) {
    throw new Error('Table is not archived')
  }

  if (table.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(table.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new Error('Cannot restore table into an archived workspace')
    }
  }

  /**
   * A concurrent rename/create can claim the chosen name after `generateRestoreName`'s check (MVCC).
   * Retries pick a new random suffix; 23505 maps to {@link TableConflictError} after exhaustion.
   */
  const maxUniqueViolationRetries = 8
  let attemptedRestoreName = ''

  for (let attempt = 0; attempt < maxUniqueViolationRetries; attempt++) {
    attemptedRestoreName = ''
    try {
      await db.transaction(async (tx) => {
        await setTableTxTimeouts(tx)
        await tx.execute(sql`SELECT 1 FROM user_table_definitions WHERE id = ${tableId} FOR UPDATE`)

        attemptedRestoreName = await generateRestoreName(table.name, async (candidate) => {
          const [match] = await tx
            .select({ id: userTableDefinitions.id })
            .from(userTableDefinitions)
            .where(
              and(
                eq(userTableDefinitions.workspaceId, table.workspaceId),
                eq(userTableDefinitions.name, candidate),
                isNull(userTableDefinitions.archivedAt)
              )
            )
            .limit(1)
          return !!match
        })

        const now = new Date()
        await tx
          .update(userTableDefinitions)
          .set({ archivedAt: null, updatedAt: now, name: attemptedRestoreName })
          .where(eq(userTableDefinitions.id, tableId))
      })
      break
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new TableConflictError(attemptedRestoreName || table.name)
      }
    }
  }

  logger.info(`[${requestId}] Restored table ${tableId} as "${attemptedRestoreName}"`)
}

/**
 * Loads `tableRowExecutions` rows for the given row ids and groups them into a
 * `Map<rowId, RowExecutions>` suitable for plugging into `TableRow.executions`.
 */
async function loadExecutionsByRow(
  trx: DbOrTx,
  rowIds: Iterable<string>
): Promise<Map<string, RowExecutions>> {
  const ids = Array.from(new Set(rowIds))
  const result = new Map<string, RowExecutions>()
  if (ids.length === 0) return result
  const rows = await trx
    .select()
    .from(tableRowExecutions)
    .where(inArray(tableRowExecutions.rowId, ids))
  for (const r of rows) {
    const existing = result.get(r.rowId) ?? {}
    const meta: RowExecutionMetadata = {
      status: r.status as RowExecutionMetadata['status'],
      executionId: r.executionId ?? null,
      jobId: r.jobId ?? null,
      workflowId: r.workflowId,
      error: r.error ?? null,
      ...(r.runningBlockIds && r.runningBlockIds.length > 0
        ? { runningBlockIds: r.runningBlockIds }
        : {}),
      ...(r.blockErrors && Object.keys(r.blockErrors as Record<string, string>).length > 0
        ? { blockErrors: r.blockErrors as Record<string, string> }
        : {}),
      ...(r.cancelledAt ? { cancelledAt: r.cancelledAt.toISOString() } : {}),
    }
    existing[r.groupId] = meta
    result.set(r.rowId, existing)
  }
  return result
}

/** Convenience: load executions for one row, returning `{}` when missing. */
async function loadExecutionsForRow(trx: DbOrTx, rowId: string): Promise<RowExecutions> {
  const byRow = await loadExecutionsByRow(trx, [rowId])
  return byRow.get(rowId) ?? {}
}

/**
 * Serializes writers that assign `position` for the same table. The row-count
 * trigger (migration 0198) serializes capacity via a row lock on
 * `user_table_definitions`, but it fires AFTER INSERT, so two concurrent
 * auto-positioned inserts could read the same snapshot and assign the same
 * position (the `(table_id, position)` index is non-unique). This advisory lock
 * restores per-table serialization. Released at COMMIT/ROLLBACK.
 */
async function acquireRowOrderLock(trx: DbTransaction, tableId: string) {
  await trx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))`
  )
}

/** Next append position for a table (max(position) + 1, or 0 if empty). */
async function nextRowPosition(trx: DbTransaction, tableId: string): Promise<number> {
  const [{ maxPos }] = await trx
    .select({
      maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
    })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxPos + 1
}

/** Largest `order_key` for a table, or `null` when empty — the append anchor for new keys. */
async function maxOrderKey(executor: DbOrTx, tableId: string): Promise<string | null> {
  const [{ maxKey }] = await executor
    .select({ maxKey: sql<string | null>`max(${userTableRows.orderKey})` })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxKey ?? null
}

/** Shifts every row at or after `position` up by one (`position + 1`). */
async function shiftRowsUpFrom(trx: DbTransaction, tableId: string, position: number) {
  await trx
    .update(userTableRows)
    .set({ position: sql`position + 1` })
    .where(and(eq(userTableRows.tableId, tableId), gte(userTableRows.position, position)))
}

/** Shifts every row after `position` down by one (`position - 1`). */
async function shiftRowsDownAfter(trx: DbTransaction, tableId: string, position: number) {
  await trx
    .update(userTableRows)
    .set({ position: sql`position - 1` })
    .where(and(eq(userTableRows.tableId, tableId), gt(userTableRows.position, position)))
}

/**
 * Reserves the `position` for a single inserted row and returns where to INSERT.
 * Acquires the row-order lock, then opens a slot at `requestedPosition` (shifting
 * the occupant + tail up) or computes the append position. Caller runs inside a
 * transaction.
 */
async function reserveInsertPosition(
  trx: DbTransaction,
  tableId: string,
  requestedPosition?: number
): Promise<number> {
  await acquireRowOrderLock(trx, tableId)
  if (requestedPosition === undefined) {
    return nextRowPosition(trx, tableId)
  }
  const [existing] = await trx
    .select({ id: userTableRows.id })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, requestedPosition)))
    .limit(1)
  if (existing) {
    await shiftRowsUpFrom(trx, tableId, requestedPosition)
  }
  return requestedPosition
}

/**
 * Reserves positions for a batch of `count` rows. Opens each requested slot
 * (ascending, preserving prior gaps) and returns the requested positions in
 * original order; otherwise returns a contiguous append range.
 */
async function reserveBatchPositions(
  trx: DbTransaction,
  tableId: string,
  count: number,
  requestedPositions?: number[]
): Promise<number[]> {
  await acquireRowOrderLock(trx, tableId)
  if (requestedPositions && requestedPositions.length > 0) {
    for (const pos of [...requestedPositions].sort((a, b) => a - b)) {
      await shiftRowsUpFrom(trx, tableId, pos)
    }
    return requestedPositions
  }
  const start = await nextRowPosition(trx, tableId)
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * Recompacts row positions to be contiguous after a bulk delete. With
 * `minDeletedPos`, only rows at/after it are re-numbered; single-row deletes use
 * the cheaper {@link shiftRowsDownAfter}.
 */
async function compactPositions(trx: DbTransaction, tableId: string, minDeletedPos?: number) {
  if (minDeletedPos === undefined) {
    await trx.execute(sql`
      UPDATE user_table_rows t
      SET position = r.new_pos
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
        FROM user_table_rows
        WHERE table_id = ${tableId}
      ) r
      WHERE t.id = r.id AND t.table_id = ${tableId} AND t.position != r.new_pos
    `)
    return
  }
  await trx.execute(sql`
    UPDATE user_table_rows t
    SET position = r.new_pos
    FROM (
      SELECT id, ${minDeletedPos}::int + ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
      FROM user_table_rows
      WHERE table_id = ${tableId} AND position >= ${minDeletedPos}
    ) r
    WHERE t.id = r.id AND t.table_id = ${tableId} AND t.position != r.new_pos
  `)
}

/** A row value ready to INSERT into `user_table_rows`, with its assigned order. */
export interface OrderedRowValue {
  id: string
  tableId: string
  workspaceId: string
  data: RowData
  position: number
  orderKey: string
  createdAt: Date
  updatedAt: Date
  createdBy?: string
}

/**
 * Builds INSERT values for a contiguous run of rows, assigning sequential
 * positions `startPosition + i` and the supplied `orderKeys[i]`. Centralizes
 * row assignment for callers that write a fresh ordered run (e.g. the copilot
 * tool's replace-all write). `orderKeys` must be index-aligned with `rows` —
 * mint them once for the whole run with {@link nKeysBetween}.
 */
export function buildOrderedRowValues(opts: {
  tableId: string
  workspaceId: string
  rows: RowData[]
  startPosition: number
  orderKeys: string[]
  now: Date
  createdBy?: string
  makeId: () => string
}): OrderedRowValue[] {
  const { tableId, workspaceId, rows, startPosition, orderKeys, now, createdBy, makeId } = opts
  return rows.map((data, i) => ({
    id: makeId(),
    tableId,
    workspaceId,
    data,
    position: startPosition + i,
    orderKey: orderKeys[i],
    createdAt: now,
    updatedAt: now,
    ...(createdBy ? { createdBy } : {}),
  }))
}

/**
 * Computes the fractional `order_key` for a row inserted at the integer
 * `requestedPosition` (or appended when omitted). Used by position-based callers
 * (mothership tool, v1 API, undo position-fallback, transient old clients).
 *
 * The neighbor at slot `s` is resolved differently per flag state:
 * - **off**: `WHERE position = s` (positions are contiguous, so the row at
 *   position `s` is the `s`-th row — an indexed O(1) lookup).
 * - **on**: the `s`-th row in `order_key, id` order (`OFFSET s`) — positions are
 *   gappy and non-authoritative, so `position = s` would miss; the visual
 *   ordinal is the key's ordinal. O(s), acceptable for these low-volume callers.
 *
 * Caller holds the row-order lock.
 */
async function resolveInsertOrderKey(
  trx: DbTransaction,
  tableId: string,
  requestedPosition?: number
): Promise<string> {
  const orderKeyAtSlot = async (slot: number): Promise<string | null> => {
    if (slot < 0) return null
    if (isTablesFractionalOrderingEnabled) {
      const [r] = await trx
        .select({ orderKey: userTableRows.orderKey })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))
        .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
        .limit(1)
        .offset(slot)
      return r?.orderKey ?? null
    }
    const [r] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, slot)))
      .limit(1)
    return r?.orderKey ?? null
  }
  if (requestedPosition === undefined) {
    return keyBetween(await maxOrderKey(trx, tableId), null)
  }
  const lo = await orderKeyAtSlot(requestedPosition - 1)
  const hi = await orderKeyAtSlot(requestedPosition)
  return keyBetween(lo, hi)
}

/**
 * Resolves the `order_key` for an insert expressed by an anchor row id —
 * `afterRowId` (place directly after) or `beforeRowId` (directly before). Finds
 * the anchor and its adjacent key via the `(table_id, order_key, id)` index
 * (O(1)) and mints a key between them. Also returns a legacy integer `position`
 * (anchor's position ±) so the flag-off shift path still works. Caller holds the
 * row-order lock.
 */
async function resolveInsertByNeighbor(
  trx: DbTransaction,
  tableId: string,
  afterRowId?: string,
  beforeRowId?: string
): Promise<{ orderKey: string; position: number }> {
  const anchorId = afterRowId ?? beforeRowId!
  const [anchor] = await trx
    .select({ orderKey: userTableRows.orderKey, position: userTableRows.position })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.id, anchorId)))
    .limit(1)
  // The client targets a specific neighbor; a missing one (concurrent delete /
  // stale view) is an error, not a silent insert at the front.
  if (!anchor) throw new Error(`Row not found: ${anchorId}`)
  const anchorKey = anchor.orderKey ?? null
  // A null key on the anchor means the table isn't backfilled. With the flag on
  // (key is authoritative) the adjacent-key lookup below can't work — fail
  // loudly rather than mint a wrong key. Flag off keeps `position` authoritative,
  // so a best-effort key here is fine (the backfill re-keys before the flip).
  if (anchorKey === null && isTablesFractionalOrderingEnabled) {
    throw new Error(`Row ${anchorId} has no order_key yet (table not backfilled)`)
  }

  if (afterRowId) {
    // hi = the smallest key strictly after the anchor.
    const [next] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          sql`(${userTableRows.orderKey}, ${userTableRows.id}) > (${anchorKey}, ${afterRowId})`
        )
      )
      .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
      .limit(1)
    return {
      orderKey: keyBetween(anchorKey, next?.orderKey ?? null),
      position: anchor.position + 1,
    }
  }

  // beforeRowId: lo = the largest key strictly before the anchor.
  const [prev] = await trx
    .select({ orderKey: userTableRows.orderKey })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, tableId),
        sql`(${userTableRows.orderKey}, ${userTableRows.id}) < (${anchorKey}, ${beforeRowId})`
      )
    )
    .orderBy(desc(userTableRows.orderKey), desc(userTableRows.id))
    .limit(1)
  return {
    orderKey: keyBetween(prev?.orderKey ?? null, anchorKey),
    position: anchor.position,
  }
}

/**
 * Computes fractional `order_key`s for a batch insert. With no `positions`,
 * appends a contiguous run after the current max key. With explicit `positions`
 * (undo restore), keys each row between its pre-shift position neighbors —
 * correct because requested positions are distinct. Caller holds the lock.
 *
 * The explicit-`positions` path is meaningful only when `position` is
 * authoritative (flag off): with the flag on, a saved `position` is a gappy
 * column value, not a visual rank, so feeding it to {@link resolveInsertOrderKey}
 * (which reads `position` as an `OFFSET` rank under the flag) would mint keys at
 * the wrong ranks. Callers needing exact placement under the flag pass
 * `orderKeys` (handled before this function); here we just append a run.
 */
async function resolveBatchInsertOrderKeys(
  trx: DbTransaction,
  tableId: string,
  count: number,
  positions?: number[]
): Promise<string[]> {
  if (!positions || positions.length === 0 || isTablesFractionalOrderingEnabled) {
    return nKeysBetween(await maxOrderKey(trx, tableId), null, count)
  }
  const keys: string[] = []
  for (const pos of positions) {
    keys.push(await resolveInsertOrderKey(trx, tableId, pos))
  }
  return keys
}

/**
 * Inserts a single row in its own transaction. Always assigns a fractional
 * `order_key`. When the fractional-ordering flag is on, `order_key` is
 * authoritative and `position` is a best-effort append (no O(N) shift); when
 * off, `position` is reserved as before (shifting to open the slot). Validation
 * and side-effect dispatch stay with the caller; capacity is enforced by the
 * `increment_user_table_row_count` trigger.
 */
async function insertOrderedRow(params: {
  tableId: string
  workspaceId: string
  data: RowData
  rowId: string
  position?: number
  afterRowId?: string
  beforeRowId?: string
  createdBy?: string
  now: Date
}): Promise<{
  id: string
  data: RowData
  position: number
  orderKey: string | null
  createdAt: Date
  updatedAt: Date
}> {
  const { tableId, workspaceId, data, rowId, position, afterRowId, beforeRowId, createdBy, now } =
    params
  const [row] = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await acquireRowOrderLock(trx, tableId)

    // Resolve the order key (and a legacy slot position for the flag-off shift
    // path) from neighbor ids when given, else from the requested position.
    let orderKey: string
    let slotPosition = position
    if (afterRowId || beforeRowId) {
      const resolved = await resolveInsertByNeighbor(trx, tableId, afterRowId, beforeRowId)
      orderKey = resolved.orderKey
      slotPosition = resolved.position
    } else {
      orderKey = await resolveInsertOrderKey(trx, tableId, position)
    }

    let targetPosition: number
    if (isTablesFractionalOrderingEnabled) {
      // order_key is authoritative — keep a best-effort, no-shift position.
      targetPosition = await nextRowPosition(trx, tableId)
    } else if (slotPosition !== undefined) {
      const [existing] = await trx
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, slotPosition)))
        .limit(1)
      if (existing) await shiftRowsUpFrom(trx, tableId, slotPosition)
      targetPosition = slotPosition
    } else {
      targetPosition = await nextRowPosition(trx, tableId)
    }

    return trx
      .insert(userTableRows)
      .values({
        id: rowId,
        tableId,
        workspaceId,
        data,
        position: targetPosition,
        orderKey,
        createdAt: now,
        updatedAt: now,
        ...(createdBy ? { createdBy } : {}),
      })
      .returning()
  })
  return {
    id: row.id,
    data: row.data as RowData,
    position: row.position,
    orderKey: row.orderKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Deletes a single row by id in its own transaction, then closes the positional
 * gap. Returns `false` when no row matched.
 */
async function deleteOrderedRow(params: {
  tableId: string
  rowId: string
  workspaceId: string
}): Promise<boolean> {
  const { tableId, rowId, workspaceId } = params
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    const [deleted] = await trx
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .returning({ position: userTableRows.position })
    if (!deleted) return false
    // Fractional ordering: deleting a row never changes another row's order_key,
    // so the O(N) position reshift is skipped entirely.
    if (!isTablesFractionalOrderingEnabled) {
      await shiftRowsDownAfter(trx, tableId, deleted.position)
    }
    return true
  })
}

/**
 * Deletes the given row ids in batches within one transaction, then recompacts
 * positions from the earliest deleted slot. Returns the deleted rows (id + prior
 * position). The caller resolves which ids to delete (used by both delete-by-ids
 * and delete-by-filter).
 */
async function deleteOrderedRowsByIds(params: {
  tableId: string
  workspaceId: string
  rowIds: string[]
}): Promise<{ id: string; position: number }[]> {
  const { tableId, workspaceId, rowIds } = params
  if (rowIds.length === 0) return []
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    const deleted: { id: string; position: number }[] = []
    for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
      const batch = rowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
      const rows = await trx
        .delete(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, workspaceId),
            inArray(userTableRows.id, batch)
          )
        )
        .returning({ id: userTableRows.id, position: userTableRows.position })
      deleted.push(...rows)
    }
    // Fractional ordering: deletes leave order_key untouched, so no recompaction.
    if (!isTablesFractionalOrderingEnabled && deleted.length > 0) {
      const minDeletedPos = deleted.reduce(
        (min, r) => (r.position < min ? r.position : min),
        deleted[0].position
      )
      await compactPositions(trx, tableId, minDeletedPos)
    }
    return deleted
  })
}

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
  dispatchAfterBatchInsert(table, result, requestId)
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
  // Undo restore passes exact saved keys; otherwise derive from positions/append.
  const orderKeys =
    data.orderKeys && data.orderKeys.length > 0
      ? data.orderKeys
      : await resolveBatchInsertOrderKeys(trx, data.tableId, data.rows.length, data.positions)
  let positions: number[]
  if (isTablesFractionalOrderingEnabled) {
    // order_key authoritative — best-effort append positions, no shift.
    const start = await nextRowPosition(trx, data.tableId)
    positions = Array.from({ length: data.rows.length }, (_, i) => start + i)
  } else {
    positions = await reserveBatchPositions(trx, data.tableId, data.rows.length, data.positions)
  }
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
  requestId: string
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
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (batchInsertRows) failed:`, err))
}

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
  requestId: string
): Promise<TableDefinition> {
  return db.transaction((trx) => addTableColumnsWithTx(trx, table, additions, requestId))
}

/** Overwrites a table's schema during an import (used when inferring columns from the file). */
export async function setTableSchemaForImport(tableId: string, schema: TableSchema): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ schema, updatedAt: new Date() })
    .where(eq(userTableDefinitions.id, tableId))
}

/**
 * Atomically claims a table for an async import. The `import_status != 'importing'` guard makes
 * this the single concurrency gate: of two racing kickoffs only one row-update matches, so only
 * one wins (no TOCTOU between a separate status check and this write). Returns whether it claimed
 * the table — the caller returns 409 when it didn't.
 */
export async function markTableImporting(tableId: string, importId: string): Promise<boolean> {
  const updated = await db
    .update(userTableDefinitions)
    .set({
      importStatus: 'importing',
      importId,
      importError: null,
      importRowsProcessed: 0,
      importStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        or(
          isNull(userTableDefinitions.importStatus),
          ne(userTableDefinitions.importStatus, 'importing')
        )
      )
    )
    .returning({ id: userTableDefinitions.id })
  return updated.length > 0
}

/**
 * Releases a claim taken by {@link markTableImporting} for a synchronous import — clears the
 * import state back to idle. Scoped to `importId` so it only clears its own claim, never a newer
 * run that may have taken over. A sync route claims, writes, then releases here in a `finally`.
 */
export async function releaseImportClaim(tableId: string, importId: string): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ importStatus: null, importId: null, importStartedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        eq(userTableDefinitions.importId, importId),
        eq(userTableDefinitions.importStatus, 'importing')
      )
    )
}

/**
 * Records import progress (rows processed so far). Also bumps `updatedAt` so the
 * stale-import janitor (`cleanup-stale-executions`) sees a live heartbeat and doesn't mark a
 * still-running import as failed.
 *
 * Scoped to `importId` AND `import_status = 'importing'`: a stale/superseded worker no longer
 * matches (its write is a no-op), and once the import is terminal (e.g. canceled) the match fails
 * too — so this returning `false` is also the worker's signal to stop. Returns whether this worker
 * still owns an in-flight import.
 */
export async function updateImportProgress(
  tableId: string,
  rowsProcessed: number,
  importId: string
): Promise<boolean> {
  const updated = await db
    .update(userTableDefinitions)
    .set({ importRowsProcessed: rowsProcessed, updatedAt: new Date() })
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        eq(userTableDefinitions.importId, importId),
        eq(userTableDefinitions.importStatus, 'importing')
      )
    )
    .returning({ id: userTableDefinitions.id })
  return updated.length > 0
}

/** Shared WHERE for terminal transitions: this import run, and still in-flight (write-once). */
function ownsActiveImport(tableId: string, importId: string) {
  return and(
    eq(userTableDefinitions.id, tableId),
    eq(userTableDefinitions.importId, importId),
    eq(userTableDefinitions.importStatus, 'importing')
  )
}

/**
 * Marks an import complete; rows become visible. No-op unless it's still this in-flight run.
 * Returns whether it transitioned, so the worker only emits the `ready` event when it actually
 * won (and not after a cancel / supersede).
 */
export async function markImportReady(tableId: string, importId: string): Promise<boolean> {
  const updated = await db
    .update(userTableDefinitions)
    .set({ importStatus: 'ready', importError: null, updatedAt: new Date() })
    .where(ownsActiveImport(tableId, importId))
    .returning({ id: userTableDefinitions.id })
  return updated.length > 0
}

/**
 * Marks an import failed, leaving any already-committed rows in place. No-op unless it's still
 * this in-flight run (so a stale worker can't clobber a newer import or a cancel).
 */
export async function markImportFailed(
  tableId: string,
  importId: string,
  error: string
): Promise<void> {
  await db
    .update(userTableDefinitions)
    .set({ importStatus: 'failed', importError: error.slice(0, 2000), updatedAt: new Date() })
    .where(ownsActiveImport(tableId, importId))
}

/**
 * Marks an in-flight import canceled (user-initiated). No-op unless it's still importing. The
 * worker's next ownership check then returns `false` and it stops; committed rows are left in
 * place (no rollback). Returns whether a running import was actually canceled.
 */
export async function markImportCanceled(tableId: string, importId: string): Promise<boolean> {
  const updated = await db
    .update(userTableDefinitions)
    .set({ importStatus: 'canceled', updatedAt: new Date() })
    .where(ownsActiveImport(tableId, importId))
    .returning({ id: userTableDefinitions.id })
  return updated.length > 0
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
 * Owns the append-import transaction so the API route never holds a `trx`:
 * optionally creates the new columns, then inserts every row in CSV-sized
 * batches — all atomic. Caller fires {@link dispatchAfterBatchInsert} after this
 * resolves (post-commit), mirroring the other batch-insert sites.
 */
export async function importAppendRows(
  table: TableDefinition,
  additions: { name: string; type: string; required?: boolean; unique?: boolean }[],
  rows: RowData[],
  ctx: { workspaceId: string; userId?: string; requestId: string }
): Promise<{ inserted: TableRow[]; table: TableDefinition }> {
  return db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
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
}

/**
 * Owns the replace-import transaction: optionally creates the new columns, then
 * replaces all rows — atomically. Keeps `trx` out of the API route.
 */
export async function importReplaceRows(
  table: TableDefinition,
  additions: { name: string; type: string; required?: boolean; unique?: boolean }[],
  data: { rows: RowData[]; workspaceId: string; userId?: string },
  requestId: string
): Promise<ReplaceRowsResult> {
  return db.transaction(async (trx) => {
    let working = table
    if (additions.length > 0) {
      working = await addTableColumnsWithTx(trx, table, additions, requestId)
    }
    return replaceTableRowsWithTx(
      trx,
      { tableId: working.id, rows: data.rows, workspaceId: data.workspaceId, userId: data.userId },
      working,
      requestId
    )
  })
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

  // Determine the single conflict target column
  let targetColumnName: string
  if (data.conflictTarget) {
    const col = uniqueColumns.find((c) => c.name === data.conflictTarget)
    if (!col) {
      throw new Error(
        `Column "${data.conflictTarget}" is not a unique column. Available unique columns: ${uniqueColumns.map((c) => c.name).join(', ')}`
      )
    }
    targetColumnName = data.conflictTarget
  } else if (uniqueColumns.length === 1) {
    targetColumnName = uniqueColumns[0].name
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
  const targetValue = data.data[targetColumnName]
  if (targetValue === undefined || targetValue === null) {
    throw new Error(`Upsert requires a value for the conflict target column "${targetColumnName}"`)
  }

  // `data->` and `data->>` accept the JSON key as a parameterized text value;
  // no need for `sql.raw` interpolation.
  const matchFilter =
    typeof targetValue === 'string'
      ? sql`${userTableRows.data}->>${targetColumnName}::text = ${String(targetValue)}`
      : sql`(${userTableRows.data}->${targetColumnName}::text)::jsonb = ${JSON.stringify(targetValue)}::jsonb`

  // Capacity enforcement for the insert path lives in the `increment_user_table_row_count`
  // trigger (migration 0198). The update path doesn't change row_count, so no check needed.
  const result = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)

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
      existingRow?.id // exclude the matched row on updates
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
        position: await reserveInsertPosition(trx, data.tableId),
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
  }).catch((err) => logger.error(`[${requestId}] auto-dispatch (upsertRow) failed:`, err))

  return result
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
    includeTotal = true,
    withExecutions = true,
  } = options

  const tableName = USER_TABLE_ROWS_SQL_NAME
  const columns = table.schema.columns

  const baseConditions = and(
    eq(userTableRows.tableId, table.id),
    eq(userTableRows.workspaceId, table.workspaceId)
  )

  let whereClause = baseConditions
  if (filter && Object.keys(filter).length > 0) {
    const filterClause = buildFilterClause(filter, tableName, columns)
    if (filterClause) {
      whereClause = and(baseConditions, filterClause)
    }
  }

  let orderByClause
  if (sort && Object.keys(sort).length > 0) {
    orderByClause = buildSortClause(sort, tableName, columns)
  }

  let query = db
    .select()
    .from(userTableRows)
    .where(whereClause ?? baseConditions)
  if (orderByClause) {
    // Explicit data-column sort: tiebreak by the default order for stability.
    query = query.orderBy(
      orderByClause,
      isTablesFractionalOrderingEnabled ? userTableRows.orderKey : userTableRows.position,
      userTableRows.id
    ) as typeof query
  } else if (isTablesFractionalOrderingEnabled) {
    query = query.orderBy(userTableRows.orderKey, userTableRows.id) as typeof query
  } else {
    query = query.orderBy(userTableRows.position) as typeof query
  }

  // Count and page fetch are independent reads — run them concurrently so the
  // `includeTotal` hot path doesn't pay two serial round-trips.
  const rowsPromise = query.limit(limit).offset(offset)
  const countPromise = includeTotal
    ? db
        .select({ count: count() })
        .from(userTableRows)
        .where(whereClause ?? baseConditions)
    : null

  const [rows, countResult] = await Promise.all([rowsPromise, countPromise])
  const totalCount = countResult ? Number(countResult[0].count) : null

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

/**
 * Derive automatic clears + cancellation candidates from a row's data patch.
 *
 * Walks `schema.workflowGroups` left-to-right with a propagating `dirtied`
 * column set. For each group whose deps overlap the dirty set, decide to
 * clear (terminal exec) or cancel+rerun (in-flight exec), then add the
 * group's outputs to the dirty set so later groups in the chain see them
 * as dirty too. This models transitive dep chains as a single forward pass —
 * editing column A propagates through group 1 (deps on A) to group 2 (deps
 * on group 1's output) without explicit DAG traversal.
 *
 * Returns:
 * - `executionsPatch`: caller's patch + nulls for cleared groups (or
 *   undefined if nothing applied).
 * - `inFlightDownstreamGroups`: groups whose dep was dirtied and that are
 *   currently in-flight. Cancel-and-restart is the caller's job.
 *
 * Assumption: `workflowGroups[]` is in topological order — a group's deps
 * may only reference columns to its left (enforced by `workflow-sidebar`'s
 * "Run after" picker + the reorder scrub via `stripGroupDeps`). Violating
 * this would silently miss the propagation.
 */
function deriveExecClearsForDataPatch(
  dataPatch: RowData,
  schema: TableSchema,
  existingExecutions: RowExecutions,
  callerPatch: Record<string, RowExecutionMetadata | null> | undefined,
  mergedData: RowData
): {
  executionsPatch: Record<string, RowExecutionMetadata | null> | undefined
  inFlightDownstreamGroups: string[]
} {
  const dirtied = new Set(Object.keys(dataPatch))
  const groupsToClear = new Set<string>()
  const inFlightDownstreamGroups: string[] = []

  // Own-output clears: when the user wipes a workflow output column, drop
  // that group's exec entry so the auto-fire reactor re-arms the cell.
  // Also flags the cleared output column as dirty so transitive downstream
  // groups see it.
  for (const [columnName, value] of Object.entries(dataPatch)) {
    const cleared = value === null || value === undefined || value === ''
    if (!cleared) continue
    const col = schema.columns.find((c) => c.name === columnName)
    if (col?.workflowGroupId) groupsToClear.add(col.workflowGroupId)
  }

  // Left-to-right walk, propagating dirty columns forward.
  const groups = schema.workflowGroups ?? []
  const afterRow = { data: mergedData } as TableRow
  for (const group of groups) {
    const deps = group.dependencies?.columns ?? []
    const depMatched = deps.some((d) => dirtied.has(d))
    if (!depMatched) continue

    // A dep column changed, but if the group's deps are no longer satisfied
    // after the patch — a checkbox was unchecked or a text dep cleared — there's
    // nothing to recompute. Leave the prior result alone instead of re-arming or
    // cancelling it; only checking a box / filling a dep drives downstream work.
    if (!areGroupDepsSatisfied(group, afterRow)) continue

    const exec = existingExecutions[group.id]
    if (exec) {
      const status = exec.status
      if (status === 'completed' || status === 'error' || status === 'cancelled') {
        groupsToClear.add(group.id)
      } else if (status === 'queued' || status === 'running' || status === 'pending') {
        inFlightDownstreamGroups.push(group.id)
      }
    } else {
      // No exec entry yet — `mode: 'new'` already covers this group. We
      // still propagate the dirty signal forward so later groups in the
      // chain see this group's outputs as dirty too.
      groupsToClear.add(group.id)
    }

    // Propagate: this group is about to be re-computed, so groups whose
    // deps reference its output columns are also dirty.
    for (const out of group.outputs) dirtied.add(out.columnName)
  }

  if (groupsToClear.size === 0) {
    return { executionsPatch: callerPatch, inFlightDownstreamGroups }
  }
  const merged: Record<string, RowExecutionMetadata | null> = { ...(callerPatch ?? {}) }
  for (const gid of groupsToClear) {
    if (!(gid in merged)) merged[gid] = null
  }
  return { executionsPatch: merged, inFlightDownstreamGroups }
}

/** Internal: thrown inside `db.transaction` to roll back when the executions
 *  guard rejects a write. The outer `.catch` translates it into a `null` return. */
class GuardRejected extends Error {
  constructor() {
    super('cell-write guard rejected')
  }
}

/** Merges an `executionsPatch` into the row's existing executions blob. */
function applyExecutionsPatch(
  existing: RowExecutions,
  patch: Record<string, RowExecutionMetadata | null> | undefined
): RowExecutions {
  if (!patch) return existing
  const next: RowExecutions = { ...existing }
  for (const [gid, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[gid]
    } else {
      next[gid] = value
    }
  }
  return next
}

/**
 * Writes a per-group execution patch for one row against the `tableRowExecutions`
 * sidecar. Non-null values upsert into the table; nulls delete the entry. When
 * `guard` is set, the upsert is gated to:
 *  - reject if a `cancelled` row for the same execution already exists, and
 *  - reject if the row exists but is owned by a different executionId
 *    (with carve-outs for missing rows and null executionIds — the dispatcher's
 *    pre-batch `pending` stamp leaves executionId unset so the first cell-task
 *    can claim).
 *
 * Returns `'guard-rejected'` when the guarded group's upsert affected 0 rows
 * (callers signal failure to the cell-task path). Returns `'wrote'` otherwise.
 */
async function writeExecutionsPatch(
  trx: DbOrTx,
  tableId: string,
  rowId: string,
  patch: Record<string, RowExecutionMetadata | null> | undefined,
  guard?: { groupId: string; executionId: string }
): Promise<'wrote' | 'guard-rejected'> {
  if (!patch) return 'wrote'
  const entries = Object.entries(patch)
  if (entries.length === 0) return 'wrote'

  for (const [gid, value] of entries) {
    if (value === null) {
      await trx
        .delete(tableRowExecutions)
        .where(and(eq(tableRowExecutions.rowId, rowId), eq(tableRowExecutions.groupId, gid)) as SQL)
      continue
    }
    const insertValues = {
      tableId,
      rowId,
      groupId: gid,
      status: value.status,
      executionId: value.executionId,
      jobId: value.jobId,
      workflowId: value.workflowId,
      error: value.error,
      runningBlockIds: value.runningBlockIds ?? [],
      blockErrors: value.blockErrors ?? {},
      cancelledAt: value.cancelledAt ? new Date(value.cancelledAt) : null,
      updatedAt: new Date(),
    } as const

    const isGuarded = guard && guard.groupId === gid
    if (isGuarded) {
      // Gate by guard semantics. The original JSONB guard had two AND'd
      // clauses; we collapse them onto the upsert's WHERE so a non-matching
      // existing row leaves the table untouched and we observe 0 affected.
      const guardExecutionId = guard.executionId
      const updated = await trx
        .insert(tableRowExecutions)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
          set: {
            status: insertValues.status,
            executionId: insertValues.executionId,
            jobId: insertValues.jobId,
            workflowId: insertValues.workflowId,
            error: insertValues.error,
            runningBlockIds: insertValues.runningBlockIds,
            blockErrors: insertValues.blockErrors,
            cancelledAt: insertValues.cancelledAt,
            updatedAt: insertValues.updatedAt,
          },
          where: and(
            // Reject any guarded worker write when the cell is `cancelled` — a
            // stop click wrote it authoritatively. SQL mirror of `isExecCancelled`
            // (deps.ts). Status-only (not executionId-scoped): the cancel can
            // only carry the pre-stamp's executionId (often null), so matching on
            // id would let the worker's real-id claim resurrect a killed cell.
            sql`${tableRowExecutions.status} <> 'cancelled'`,
            // Stale-worker: the cell's active run has moved on. Carve-outs
            // permit a fresh worker to take over when the row's executionId
            // is unset (dispatcher's pre-batch `pending` stamp).
            sql`(${tableRowExecutions.executionId} IS NULL OR ${tableRowExecutions.executionId} = ${guardExecutionId})`
          ) as SQL,
        })
        .returning({ rowId: tableRowExecutions.rowId })
      if (updated.length === 0) return 'guard-rejected'
      continue
    }

    await trx
      .insert(tableRowExecutions)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [tableRowExecutions.rowId, tableRowExecutions.groupId],
        set: {
          status: insertValues.status,
          executionId: insertValues.executionId,
          jobId: insertValues.jobId,
          workflowId: insertValues.workflowId,
          error: insertValues.error,
          runningBlockIds: insertValues.runningBlockIds,
          blockErrors: insertValues.blockErrors,
          cancelledAt: insertValues.cancelledAt,
          updatedAt: insertValues.updatedAt,
        },
      })
  }

  return 'wrote'
}

/**
 * Strips the given workflow group ids from every row's executions on a table —
 * used by the column / group delete paths so stale running/queued exec records
 * don't linger and inflate counters after the group is gone. The caller wraps
 * in their own transaction.
 */
async function stripGroupExecutions(
  trx: DbOrTx,
  tableId: string,
  groupIds: Iterable<string>
): Promise<void> {
  const ids = Array.from(new Set(groupIds))
  if (ids.length === 0) return
  await trx
    .delete(tableRowExecutions)
    .where(
      and(eq(tableRowExecutions.tableId, tableId), inArray(tableRowExecutions.groupId, ids)) as SQL
    )
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

  let query = db
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(and(baseConditions, filterClause))

  if (data.limit) {
    query = query.limit(data.limit) as typeof query
  }

  const matchingRows = await query

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

  let query = db
    .select({ id: userTableRows.id, position: userTableRows.position })
    .from(userTableRows)
    .where(and(baseConditions, filterClause))

  if (data.limit) {
    query = query.limit(data.limit) as typeof query
  }

  const matchingRows = await query

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

/**
 * Renames a column in a table's schema and updates all row data keys.
 *
 * @param data - Rename column data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or new name conflicts
 */
export async function renameColumn(
  data: RenameColumnData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    if (!NAME_PATTERN.test(data.newName)) {
      throw new Error(
        `Invalid column name "${data.newName}". Column names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
      )
    }

    if (data.newName.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }

    const schema = table.schema
    const columnIndex = schema.columns.findIndex(
      (c) => c.name.toLowerCase() === data.oldName.toLowerCase()
    )
    if (columnIndex === -1) {
      throw new Error(`Column "${data.oldName}" not found`)
    }

    if (
      schema.columns.some(
        (c, i) => i !== columnIndex && c.name.toLowerCase() === data.newName.toLowerCase()
      )
    ) {
      throw new Error(`Column "${data.newName}" already exists`)
    }

    const actualOldName = schema.columns[columnIndex].name
    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex ? { ...c, name: data.newName } : c
    )
    // Cascade rename into every workflow group: its output `columnName` refs,
    // its `dependencies.columns` entries, and its `inputMappings` source columns.
    const updatedGroups = (schema.workflowGroups ?? []).map((group) => {
      const renamedOutputs = group.outputs.map((o) =>
        o.columnName === actualOldName ? { ...o, columnName: data.newName } : o
      )
      const renamedDeps = group.dependencies?.columns?.map((d) =>
        d === actualOldName ? data.newName : d
      )
      const renamedMappings = group.inputMappings?.map((m) =>
        m.columnName === actualOldName ? { ...m, columnName: data.newName } : m
      )
      return {
        ...group,
        outputs: renamedOutputs,
        ...(renamedDeps ? { dependencies: { columns: renamedDeps } } : {}),
        ...(renamedMappings ? { inputMappings: renamedMappings } : {}),
      }
    })
    const updatedSchema: TableSchema = {
      ...schema,
      columns: updatedColumns,
      ...(updatedGroups.length > 0 ? { workflowGroups: updatedGroups } : {}),
    }

    const metadata = table.metadata as TableMetadata | null
    let updatedMetadata = metadata
    if (metadata?.columnWidths && actualOldName in metadata.columnWidths) {
      const { [actualOldName]: width, ...rest } = metadata.columnWidths
      updatedMetadata = { ...metadata, columnWidths: { ...rest, [data.newName]: width } }
    }
    if (updatedMetadata?.columnOrder?.includes(actualOldName)) {
      updatedMetadata = {
        ...updatedMetadata,
        columnOrder: updatedMetadata.columnOrder.map((n) =>
          n === actualOldName ? data.newName : n
        ),
      }
    }
    // Validate against the *post-rename* column order. The schema's workflow
    // group outputs already reference the new name, so checking against the old
    // columnOrder makes the renamed output look "missing" from its group and
    // falsely flags the remaining siblings as non-contiguous.
    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()
    const statementMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs })

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    // All bindings parameterized — `data->` accepts a text parameter for the
    // key, no need to drop into `sql.raw` with hand-rolled quote escaping.
    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${actualOldName}::text || jsonb_build_object(${data.newName}::text, data->${actualOldName}::text) WHERE table_id = ${data.tableId} AND data ? ${actualOldName}::text`
    )

    logger.info(
      `[${requestId}] Renamed column "${actualOldName}" to "${data.newName}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Deletes a column from a table's schema and removes the key from all row data.
 *
 * @param data - Delete column data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or it's the last column
 */
export async function deleteColumn(
  data: DeleteColumnData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const columnIndex = schema.columns.findIndex(
      (c) => c.name.toLowerCase() === data.columnName.toLowerCase()
    )
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    if (schema.columns.length <= 1) {
      throw new Error('Cannot delete the last column in a table')
    }

    const targetColumn = schema.columns[columnIndex]
    const actualName = targetColumn.name
    const ownerGroupId = targetColumn.workflowGroupId

    // Drop this column's reference from every group's outputs and `columns`
    // dependency. If the column is the last output of its parent group, the
    // group itself is also removed (a group with zero outputs is invalid).
    let groupRemovedId: string | null = null
    const updatedGroups = (schema.workflowGroups ?? [])
      .map((group) => {
        let next = group
        if (ownerGroupId && group.id === ownerGroupId) {
          const remaining = group.outputs.filter((o) => o.columnName !== actualName)
          if (remaining.length === 0) {
            groupRemovedId = group.id
          }
          next = { ...next, outputs: remaining }
        }
        return stripGroupDeps(next, new Set([actualName]))
      })
      .filter((g) => g.id !== groupRemovedId)

    const updatedSchema: TableSchema = {
      ...schema,
      columns: schema.columns.filter((_, i) => i !== columnIndex),
      ...(updatedGroups.length > 0 ? { workflowGroups: updatedGroups } : {}),
    }
    assertValidSchema(updatedSchema, table.metadata?.columnOrder)

    const metadata = table.metadata as TableMetadata | null
    let updatedMetadata = metadata
    if (metadata?.columnWidths && actualName in metadata.columnWidths) {
      const { [actualName]: _, ...rest } = metadata.columnWidths
      updatedMetadata = { ...metadata, columnWidths: rest }
    }

    const now = new Date()
    const statementMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs })

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${actualName}::text WHERE table_id = ${data.tableId} AND data ? ${actualName}::text`
    )
    if (groupRemovedId) await stripGroupExecutions(trx, data.tableId, [groupRemovedId])

    logger.info(`[${requestId}] Deleted column "${actualName}" from table ${data.tableId}`)

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Deletes multiple columns from a table in a single transaction.
 * Avoids the race condition of calling deleteColumn multiple times in parallel.
 */
export async function deleteColumns(
  data: { tableId: string; columnNames: string[] },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const namesToDelete = new Set<string>()
    const notFound: string[] = []

    for (const name of data.columnNames) {
      const col = schema.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())
      if (!col) {
        notFound.push(name)
      } else {
        namesToDelete.add(col.name)
      }
    }

    if (notFound.length > 0) {
      throw new Error(`Columns not found: ${notFound.join(', ')}`)
    }

    const remaining = schema.columns.filter((c) => !namesToDelete.has(c.name))
    if (remaining.length === 0) {
      throw new Error('Cannot delete all columns from a table')
    }

    // For each group, drop outputs whose column is being deleted. Groups that
    // end up with zero outputs are removed entirely (they'd be invalid). Then
    // any remaining group's dependencies referencing a removed group or
    // deleted column are cleaned up.
    const removedGroupIds = new Set<string>()
    let updatedGroups = (schema.workflowGroups ?? []).map((group) => {
      const remainingOutputs = group.outputs.filter((o) => !namesToDelete.has(o.columnName))
      if (remainingOutputs.length === 0) {
        removedGroupIds.add(group.id)
      }
      return remainingOutputs.length === group.outputs.length
        ? group
        : { ...group, outputs: remainingOutputs }
    })
    updatedGroups = updatedGroups
      .filter((g) => !removedGroupIds.has(g.id))
      .map((group) => stripGroupDeps(group, namesToDelete))
    const updatedSchema: TableSchema = {
      ...schema,
      columns: remaining,
      ...(updatedGroups.length > 0 ? { workflowGroups: updatedGroups } : {}),
    }
    assertValidSchema(updatedSchema, table.metadata?.columnOrder)

    const metadata = table.metadata as TableMetadata | null
    let updatedMetadata = metadata
    if (metadata?.columnWidths) {
      const widths = { ...metadata.columnWidths }
      for (const n of namesToDelete) delete widths[n]
      updatedMetadata = { ...metadata, columnWidths: widths }
    }

    const now = new Date()
    const statementMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2 * namesToDelete.size,
    })
    await setTableTxTimeouts(trx, { statementMs })

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    for (const name of namesToDelete) {
      await trx.execute(
        sql`UPDATE user_table_rows SET data = data - ${name}::text WHERE table_id = ${data.tableId} AND data ? ${name}::text`
      )
    }
    await stripGroupExecutions(trx, data.tableId, removedGroupIds)

    logger.info(
      `[${requestId}] Deleted columns [${[...namesToDelete].join(', ')}] from table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Changes the type of a column. Validates that existing data is compatible.
 *
 * @param data - Update column type data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or existing data is incompatible
 */
export async function updateColumnType(
  data: UpdateColumnTypeData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    // Scale both statement and idle timeouts to row count: the compatibility
    // check below iterates every row in Node between the row SELECT and the
    // schema UPDATE, leaving the transaction idle for that gap. The default 5s
    // `idle_in_transaction_session_timeout` would abort a valid type change on
    // a large table.
    const timeoutMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs: timeoutMs, idleMs: timeoutMs })

    if (!(COLUMN_TYPES as readonly string[]).includes(data.newType)) {
      throw new Error(
        `Invalid column type "${data.newType}". Valid types: ${COLUMN_TYPES.join(', ')}`
      )
    }

    const schema = table.schema
    const columnIndex = schema.columns.findIndex(
      (c) => c.name.toLowerCase() === data.columnName.toLowerCase()
    )
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    const column = schema.columns[columnIndex]
    if (column.type === data.newType) {
      return table
    }

    // Validate existing data is compatible with the new type
    const rows = await trx
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, data.tableId),
          sql`${userTableRows.data} ? ${column.name}`,
          sql`${userTableRows.data}->>${column.name}::text IS NOT NULL`
        )
      )

    let incompatibleCount = 0
    for (const row of rows) {
      const rowData = row.data as RowData
      const value = rowData[column.name]
      if (value === null || value === undefined) continue

      if (!isValueCompatibleWithType(value, data.newType)) {
        incompatibleCount++
      }
    }

    if (incompatibleCount > 0) {
      throw new Error(
        `Cannot change column "${column.name}" to type "${data.newType}": ${incompatibleCount} row(s) have incompatible values. Fix or remove the incompatible values first.`
      )
    }

    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex ? { ...c, type: data.newType } : c
    )
    const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Changed column "${column.name}" type from "${column.type}" to "${data.newType}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, updatedAt: now }
  })
}

/**
 * Updates constraints (required, unique) on a column.
 *
 * @param data - Update column constraints data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or existing data violates the constraint
 */
export async function updateColumnConstraints(
  data: UpdateColumnConstraintsData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    // Scale both statement and idle timeouts to row count: the required/unique
    // validation runs between separate queries inside this transaction, leaving
    // it briefly idle. Match `updateColumnType` so the default 5s
    // `idle_in_transaction_session_timeout` can't abort a valid change on a
    // large table.
    const timeoutMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs: timeoutMs, idleMs: timeoutMs })

    const schema = table.schema
    const columnIndex = schema.columns.findIndex(
      (c) => c.name.toLowerCase() === data.columnName.toLowerCase()
    )
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    const column = schema.columns[columnIndex]
    if (column.workflowGroupId) {
      throw new Error(
        `Cannot change constraints on workflow-output column "${column.name}". Constraints aren't applicable to columns whose values come from workflow execution.`
      )
    }
    if (data.required === true && !column.required) {
      const [result] = await trx
        .select({ count: count() })
        .from(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, data.tableId),
            sql`(NOT (${userTableRows.data} ? ${column.name}) OR ${userTableRows.data}->>${column.name}::text IS NULL)`
          )
        )

      if (result.count > 0) {
        throw new Error(
          `Cannot set column "${column.name}" as required: ${result.count} row(s) have null or missing values`
        )
      }
    }

    if (data.unique === true && !column.unique) {
      const duplicates = (await trx.execute(
        sql`SELECT ${userTableRows.data}->>${column.name}::text AS val, count(*) AS cnt FROM ${userTableRows} WHERE table_id = ${data.tableId} AND ${userTableRows.data} ? ${column.name} AND ${userTableRows.data}->>${column.name}::text IS NOT NULL GROUP BY val HAVING count(*) > 1 LIMIT 1`
      )) as { val: string; cnt: number }[]

      if (duplicates.length > 0) {
        throw new Error(`Cannot set column "${column.name}" as unique: duplicate values exist`)
      }
    }

    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex
        ? {
            ...c,
            ...(data.required !== undefined ? { required: data.required } : {}),
            ...(data.unique !== undefined ? { unique: data.unique } : {}),
          }
        : c
    )
    const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Updated constraints for column "${column.name}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, updatedAt: now }
  })
}

/**
 * Atomically inserts a workflow group plus its output columns into a table's
 * schema. Both arrays update in one DB write so the schema is never observed
 * mid-mutation (e.g. columns referencing a group that doesn't yet exist).
 */
export async function addWorkflowGroup(
  data: AddWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const updatedTable = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    if (groups.some((g) => g.id === data.group.id)) {
      throw new Error(`Workflow group "${data.group.id}" already exists`)
    }

    const existingNames = new Set(schema.columns.map((c) => c.name.toLowerCase()))
    for (const col of data.outputColumns) {
      if (!NAME_PATTERN.test(col.name)) {
        throw new Error(
          `Invalid output column name "${col.name}". Must satisfy ${NAME_PATTERN.source}.`
        )
      }
      if (existingNames.has(col.name.toLowerCase())) {
        throw new Error(`Column "${col.name}" already exists`)
      }
    }

    if (schema.columns.length + data.outputColumns.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding ${data.outputColumns.length} columns would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    const updatedSchema: TableSchema = {
      ...schema,
      columns: [...schema.columns, ...data.outputColumns],
      workflowGroups: [...groups, data.group],
    }

    // Keep `metadata.columnOrder` in sync — see `addTableColumn` for the
    // invariant. New output columns get appended in the order the caller
    // supplied (matches their position in `schema.columns`).
    const existingOrder = table.metadata?.columnOrder
    let updatedMetadata = table.metadata
    if (existingOrder && existingOrder.length > 0) {
      const known = new Set(existingOrder)
      const append = data.outputColumns.map((c) => c.name).filter((n) => !known.has(n))
      if (append.length > 0) {
        updatedMetadata = { ...table.metadata, columnOrder: [...existingOrder, ...append] }
      }
    }

    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added workflow group "${data.group.id}" with ${data.outputColumns.length} output column(s) to table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })

  // Auto-fire existing rows whose deps are already met for the new group.
  // Fire-and-forget — the dispatcher bounds queue depth (window of 20) and
  // walks the table in the background. HTTP returns instantly; cells fill
  // in over the next minutes as the dispatcher walks. Mothership opts out
  // by setting `autoRun: false`.
  if (data.autoRun !== false) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.group.id],
      requestId,
    }).catch((err) => logger.error(`[${requestId}] auto-dispatch (addWorkflowGroup) failed:`, err))
  }

  return updatedTable
}

/**
 * Updates a workflow group: any combination of workflowId, name, dependencies,
 * outputs[]. Computes added/removed outputs vs current state and inserts /
 * removes columns transactionally. Removed outputs also clear their key from
 * every row's `data`.
 */
export async function updateWorkflowGroup(
  data: UpdateWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const mappingUpdates = data.mappingUpdates ?? []

  // Phase 1 (no lock): when there are mapping updates, load the workflow once to
  // resolve each remap's new leaf type. Kept OFF the advisory-lock critical
  // section so concurrent group edits on the same table don't time out waiting
  // on this DB load. Best-effort — a resolution failure leaves column types
  // unchanged (workflow deleted, block removed). The result is applied against
  // the fresh schema under the lock in phase 2.
  const remapLeafTypeByColumn = new Map<string, ColumnDefinition['type']>()
  // The workflow id the leaf types above were resolved against. Phase 2 only
  // applies the resolved types if the group still points at this workflow under
  // the lock — a concurrent `workflowId` change would make them stale.
  let resolvedForWorkflowId: string | undefined
  if (mappingUpdates.length > 0) {
    try {
      const preTable = await getTableById(data.tableId)
      const preGroup = preTable?.schema.workflowGroups?.find((g) => g.id === data.groupId)
      const targetWorkflowId = data.workflowId ?? preGroup?.workflowId
      if (targetWorkflowId) {
        resolvedForWorkflowId = targetWorkflowId
        const [
          { loadWorkflowFromNormalizedTables },
          { flattenWorkflowOutputs },
          { columnTypeForLeaf },
        ] = await Promise.all([
          import('@/lib/workflows/persistence/utils'),
          import('@/lib/workflows/blocks/flatten-outputs'),
          import('./column-naming'),
        ])
        const normalized = await loadWorkflowFromNormalizedTables(targetWorkflowId)
        if (normalized) {
          const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
            id: b.id,
            type: b.type,
            name: b.name,
            triggerMode: (b as { triggerMode?: boolean }).triggerMode,
            subBlocks: b.subBlocks as Record<string, unknown> | undefined,
          }))
          const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
          const flatByKey = new Map(flattened.map((f) => [`${f.blockId}::${f.path}`, f]))
          for (const u of mappingUpdates) {
            const match = flatByKey.get(`${u.blockId}::${u.path}`)
            if (!match) continue
            const newType = columnTypeForLeaf(match.leafType)
            if (newType) remapLeafTypeByColumn.set(u.columnName, newType)
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[${requestId}] Could not resolve new leaf types for remap on group ${data.groupId}; leaving column types unchanged:`,
        err
      )
    }
  }

  const { updatedTable, added, remappedColumnNames, newOutputs, previousAutoRun } =
    await withLockedTable(data.tableId, async (table, trx) => {
      await setTableTxTimeouts(trx, { statementMs: 60_000 })

      const schema = table.schema
      const groups = schema.workflowGroups ?? []
      const groupIndex = groups.findIndex((g) => g.id === data.groupId)
      if (groupIndex === -1) {
        throw new Error(`Workflow group "${data.groupId}" not found`)
      }
      const group = groups[groupIndex]

      // Apply `mappingUpdates` first: each entry repoints an existing output's
      // `(blockId, path)` while preserving the column. We patch the **old** view
      // of outputs so the downstream `(blockId, path)`-keyed diff doesn't see the
      // swap as a remove+add. The corresponding row data is cleared after the
      // schema write so stale values from the old source don't linger.
      const remappedColumnNames = new Set<string>()
      // Per-column type override resolved (out-of-lock) from the new mapping's
      // leaf type. Only populated when a remap actually changes the column's
      // type against the fresh schema — keeps the schema patch a no-op when the
      // user repoints to an output of the same type.
      const remappedColumnTypes = new Map<string, ColumnDefinition['type']>()
      let oldOutputs = group.outputs
      if (mappingUpdates.length > 0) {
        const updateByName = new Map(mappingUpdates.map((u) => [u.columnName, u]))
        for (const u of mappingUpdates) {
          const exists = oldOutputs.some((o) => o.columnName === u.columnName)
          if (!exists) {
            throw new Error(
              `Mapping update for unknown column "${u.columnName}" (group ${data.groupId}).`
            )
          }
        }
        oldOutputs = oldOutputs.map((o) => {
          const u = updateByName.get(o.columnName)
          if (!u) return o
          remappedColumnNames.add(o.columnName)
          return { ...o, blockId: u.blockId, path: u.path }
        })

        // Only apply the out-of-lock leaf-type resolution if the group still
        // points at the workflow we resolved against. If a concurrent writer
        // changed `workflowId` between phase 1 and now, those types are stale —
        // leave column types unchanged (best-effort, same as a resolution
        // failure) rather than stamping types from the old workflow.
        const finalWorkflowId = data.workflowId ?? group.workflowId
        if (remapLeafTypeByColumn.size > 0 && resolvedForWorkflowId !== finalWorkflowId) {
          logger.warn(
            `[${requestId}] Workflow group "${data.groupId}" workflowId changed between leaf-type resolution and apply; leaving remapped column types unchanged.`
          )
        } else {
          const colByName = new Map(schema.columns.map((c) => [c.name, c]))
          for (const u of mappingUpdates) {
            const newType = remapLeafTypeByColumn.get(u.columnName)
            if (!newType) continue
            const oldType = colByName.get(u.columnName)?.type
            if (newType !== oldType) {
              remappedColumnTypes.set(u.columnName, newType)
            }
          }
        }
      }

      // If the caller passed `outputs`, that's the new full set. If only
      // `mappingUpdates` was sent, the new set is the remapped old set.
      const newOutputs = data.outputs ?? oldOutputs
      // Enrichment outputs all share empty `blockId`/`path`, so keying on those
      // alone collapses every sibling to one entry (dropping columns on diff). Key
      // on the registry `outputId` when present; fall back to `blockId::path` for
      // workflow outputs.
      const oldKey = (o: WorkflowGroupOutput) =>
        o.outputId ? `out::${o.outputId}` : `${o.blockId}::${o.path}`
      const oldByKey = new Map(oldOutputs.map((o) => [oldKey(o), o]))
      const newByKey = new Map(newOutputs.map((o) => [oldKey(o), o]))

      const removed = oldOutputs.filter((o) => !newByKey.has(oldKey(o)))
      const added = newOutputs.filter((o) => !oldByKey.has(oldKey(o)))
      const newColDefs = data.newOutputColumns ?? []
      const newColByName = new Map(newColDefs.map((c) => [c.name, c]))

      for (const out of added) {
        if (!newColByName.has(out.columnName)) {
          throw new Error(
            `Missing column definition for new output "${out.columnName}" (group ${data.groupId}).`
          )
        }
      }

      const removedColumnNames = new Set(removed.map((o) => o.columnName))
      let nextColumns = schema.columns
        .filter((c) => !removedColumnNames.has(c.name))
        .map((c) => {
          const newType = remappedColumnTypes.get(c.name)
          return newType ? { ...c, type: newType } : c
        })
      if (newColDefs.length > 0) {
        // Splice the new column defs into the group's contiguous run rather than
        // appending at the end. The desired in-group order is `newOutputs` (the
        // sidebar's BFS-of-the-workflow ordering); we walk it, anchor at the first
        // surviving sibling's index in `nextColumns`, and emit each output's
        // column def in turn.
        const groupColNames = new Set(newOutputs.map((o) => o.columnName))
        const firstGroupIdx = nextColumns.findIndex((c) => groupColNames.has(c.name))
        const anchorIdx = firstGroupIdx === -1 ? nextColumns.length : firstGroupIdx
        const newColByLowerName = new Map(newColDefs.map((c) => [c.name.toLowerCase(), c]))
        const orderedGroupCols: ColumnDefinition[] = []
        for (const out of newOutputs) {
          const fresh = newColByLowerName.get(out.columnName.toLowerCase())
          if (fresh) {
            orderedGroupCols.push(fresh)
          } else {
            const existing = nextColumns.find(
              (c) => c.name.toLowerCase() === out.columnName.toLowerCase()
            )
            if (existing) orderedGroupCols.push(existing)
          }
        }
        const remaining = nextColumns.filter((c) => !groupColNames.has(c.name))
        nextColumns = [
          ...remaining.slice(0, anchorIdx),
          ...orderedGroupCols,
          ...remaining.slice(anchorIdx),
        ]
      }

      const updatedGroup: WorkflowGroup = {
        ...group,
        workflowId: data.workflowId ?? group.workflowId,
        name: data.name ?? group.name,
        dependencies: data.dependencies ?? group.dependencies,
        outputs: newOutputs,
        ...(data.inputMappings !== undefined ? { inputMappings: data.inputMappings } : {}),
        ...(data.deploymentMode !== undefined ? { deploymentMode: data.deploymentMode } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.autoRun !== undefined ? { autoRun: data.autoRun } : {}),
      }
      // Removed outputs may be referenced as deps by sibling groups; strip those
      // refs so we don't leave dangling-column deps that fail schema validation.
      const nextGroups = groups
        .map((g, i) => (i === groupIndex ? updatedGroup : g))
        .map((g) => (g.id === updatedGroup.id ? g : stripGroupDeps(g, removedColumnNames)))
      const updatedSchema: TableSchema = {
        ...schema,
        columns: nextColumns,
        workflowGroups: nextGroups,
      }

      // `columnOrder` mirrors the schema layout. Drop removed columns, then splice
      // the new ones in at the same anchor as `nextColumns` so the table renders
      // them inside the group's contiguous run instead of at the tail.
      let updatedColumnOrder = table.metadata?.columnOrder?.filter(
        (n) => !removedColumnNames.has(n)
      )
      if (updatedColumnOrder && newColDefs.length > 0) {
        const newColNamesLower = new Set(newColDefs.map((c) => c.name.toLowerCase()))
        const orderWithoutNew = updatedColumnOrder.filter(
          (n) => !newColNamesLower.has(n.toLowerCase())
        )
        const groupColNames = new Set(newOutputs.map((o) => o.columnName))
        const orderedGroupNames = newOutputs.map((o) => o.columnName)
        const firstGroupOrderIdx = orderWithoutNew.findIndex((n) => groupColNames.has(n))
        const anchorOrderIdx =
          firstGroupOrderIdx === -1 ? orderWithoutNew.length : firstGroupOrderIdx
        const remainingOrder = orderWithoutNew.filter((n) => !groupColNames.has(n))
        updatedColumnOrder = [
          ...remainingOrder.slice(0, anchorOrderIdx),
          ...orderedGroupNames,
          ...remainingOrder.slice(anchorOrderIdx),
        ]
      }
      assertValidSchema(updatedSchema, updatedColumnOrder)

      const updatedMetadata: TableMetadata | null =
        updatedColumnOrder && table.metadata
          ? { ...table.metadata, columnOrder: updatedColumnOrder }
          : table.metadata
            ? { ...table.metadata }
            : null

      const now = new Date()
      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
        .where(eq(userTableDefinitions.id, data.tableId))
      for (const name of removedColumnNames) {
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${name}::text WHERE table_id = ${data.tableId} AND data ? ${name}::text`
        )
      }
      // Remapped columns: clear stale values in-tx so rows the backfill can't
      // repopulate (no log, no matching span output) end up empty rather than
      // retaining the previous mapping's value. The backfill below then writes
      // the new mapping's value into rows where it can find one.
      for (const name of remappedColumnNames) {
        if (removedColumnNames.has(name)) continue
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${name}::text WHERE table_id = ${data.tableId} AND data ? ${name}::text`
        )
      }

      logger.info(
        `[${requestId}] Updated workflow group "${data.groupId}" in table ${data.tableId} (added=${added.length}, removed=${removed.length}, remapped=${remappedColumnNames.size})`
      )

      const updatedTable: TableDefinition = {
        ...table,
        schema: updatedSchema,
        metadata: updatedMetadata,
        updatedAt: now,
      }
      return {
        updatedTable,
        added,
        remappedColumnNames,
        newOutputs,
        previousAutoRun: group.autoRun,
      }
    })

  // Backfill from saved execution logs so already-completed group runs surface
  // the schema changes without re-running the workflow. Two passes:
  //   - added outputs (new columns): never overwrite hand-edited values.
  //   - remapped outputs (existing column re-pointed): overwrite, since the
  //     new mapping is the source of truth and the user expects the cell to
  //     refresh to the new output's value.
  // Awaited so the response only returns once row data is consistent. A
  // failed backfill is logged but doesn't fail the request — the schema
  // change has already committed.
  if (added.length > 0) {
    try {
      await backfillGroupOutputsFromLogs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: added,
        overwrite: false,
        requestId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }
  if (remappedColumnNames.size > 0) {
    const remappedOutputs = newOutputs.filter((o) => remappedColumnNames.has(o.columnName))
    try {
      await backfillGroupOutputsFromLogs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: remappedOutputs,
        overwrite: true,
        requestId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Remap backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }

  // autoRun toggled false → true: fire deps-satisfied rows now via the
  // dispatcher. Mirrors the post-add path so re-enabling auto-fire doesn't
  // require manual run clicks for rows that are already eligible.
  if (previousAutoRun === false && data.autoRun === true) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.groupId],
      requestId,
    }).catch((err) =>
      logger.error(`[${requestId}] auto-dispatch (updateWorkflowGroup autoRun=true) failed:`, err)
    )
  }

  return updatedTable
}

/**
 * Adds a single output to an existing workflow group. Mirrors `addTableColumn`
 * for plain columns: one canonical op, one column created, type inferred from
 * the workflow's flattened outputs (`leafType` for `(blockId, path)`). The
 * column is spliced into the group's contiguous run so the table renders the
 * new output next to its siblings.
 */
export async function addWorkflowGroupOutput(
  data: {
    tableId: string
    groupId: string
    blockId: string
    path: string
    /** Optional override; defaults to a slug derived from `path`. */
    columnName?: string
  },
  requestId: string
): Promise<TableDefinition> {
  // Phase 1 (no lock): load the workflow and resolve the pickable output plus
  // its execution-order index. This depends only on the workflow graph (which
  // is stable), so it runs OFF the advisory-lock critical section — holding the
  // lock during this DB load would make concurrent adders on the same table
  // time out waiting (the Mothership fan-out this fix targets). Phase 2
  // re-validates that the group still maps to the same workflow under the lock.
  const preTable = await getTableById(data.tableId)
  if (!preTable) throw new Error('Table not found')
  const preGroup = (preTable.schema.workflowGroups ?? []).find((g) => g.id === data.groupId)
  if (!preGroup) {
    throw new Error(`Workflow group "${data.groupId}" not found`)
  }
  const workflowId = preGroup.workflowId

  const [
    { loadWorkflowFromNormalizedTables },
    { flattenWorkflowOutputs, getBlockExecutionOrder },
    { columnTypeForLeaf, deriveOutputColumnName },
  ] = await Promise.all([
    import('@/lib/workflows/persistence/utils'),
    import('@/lib/workflows/blocks/flatten-outputs'),
    import('./column-naming'),
  ])
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} not found`)
  }
  const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    triggerMode: (b as { triggerMode?: boolean }).triggerMode,
    subBlocks: b.subBlocks as Record<string, unknown> | undefined,
  }))
  const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
  const match = flattened.find((f) => f.blockId === data.blockId && f.path === data.path)
  if (!match) {
    throw new Error(
      `Output ${data.blockId}::${data.path} is not a valid pickable output on workflow ${workflowId}`
    )
  }
  const newColumnType = columnTypeForLeaf(match.leafType)
  const distances = getBlockExecutionOrder(blocks, normalized.edges ?? [])
  const flatIndex = new Map(flattened.map((f, i) => [`${f.blockId}::${f.path}`, i]))

  // Phase 2 (locked): re-read fresh, validate against the current schema, and
  // write. The critical section holds no I/O — just the in-memory splice + the
  // schema UPDATE — so concurrent adders queue behind it quickly.
  const { updatedTable, newOutput } = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    if (group.workflowId !== workflowId) {
      throw new Error(
        `Workflow group "${data.groupId}" was remapped to a different workflow concurrently; retry the add.`
      )
    }

    if (group.outputs.some((o) => o.blockId === data.blockId && o.path === data.path)) {
      throw new Error(
        `Workflow group "${data.groupId}" already has an output at ${data.blockId}::${data.path}`
      )
    }

    const taken = new Set(schema.columns.map((c) => c.name))
    const columnName = data.columnName ?? deriveOutputColumnName(data.path, taken)
    if (!NAME_PATTERN.test(columnName)) {
      throw new Error(`Invalid column name "${columnName}". Must satisfy ${NAME_PATTERN.source}.`)
    }
    if (taken.has(columnName)) {
      throw new Error(`Column "${columnName}" already exists`)
    }
    if (schema.columns.length + 1 > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding a column would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    const newColDef: ColumnDefinition = {
      name: columnName,
      type: newColumnType,
      required: false,
      unique: false,
      workflowGroupId: data.groupId,
    }
    const newOutput: WorkflowGroupOutput = {
      blockId: data.blockId,
      path: data.path,
      columnName,
    }

    // Sort all of the group's outputs (existing + new) in workflow execution
    // order: BFS distance from the start block ASC, with discovery order as
    // tiebreak. This matches what the column-sidebar does at create time, so
    // columns from the same workflow always read in the order their blocks run
    // — regardless of whether they were added at create time or one-by-one.
    const groupColNamesBefore = new Set(group.outputs.map((o) => o.columnName))
    const orderKey = (o: { blockId: string; path: string }) => {
      const d = distances[o.blockId]
      const dist = d === undefined || d < 0 ? Number.POSITIVE_INFINITY : d
      const idx = flatIndex.get(`${o.blockId}::${o.path}`) ?? Number.POSITIVE_INFINITY
      return [dist, idx] as const
    }
    const allGroupOutputs = [...group.outputs, newOutput].sort((a, b) => {
      const [da, ia] = orderKey(a)
      const [db, ib] = orderKey(b)
      return da !== db ? da - db : ia - ib
    })
    const orderedGroupColNames = allGroupOutputs.map((o) => o.columnName)
    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: allGroupOutputs,
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))

    // Splice the new column run into nextColumns: keep the columns outside the
    // group where they were, replace the group's contiguous run with the
    // BFS-ordered list. Anchor at the position of the first existing sibling
    // (or append if the group was empty).
    const colByName = new Map(schema.columns.map((c) => [c.name, c]))
    const orderedGroupCols: ColumnDefinition[] = orderedGroupColNames.map((name) => {
      if (name === columnName) return newColDef
      const existing = colByName.get(name)
      if (!existing) {
        throw new Error(`Internal: column "${name}" missing while splicing group outputs`)
      }
      return existing
    })
    const remainingCols = schema.columns.filter((c) => !groupColNamesBefore.has(c.name))
    const firstGroupIdx = schema.columns.findIndex((c) => groupColNamesBefore.has(c.name))
    const colAnchor = firstGroupIdx === -1 ? remainingCols.length : firstGroupIdx
    const nextColumns = [
      ...remainingCols.slice(0, colAnchor),
      ...orderedGroupCols,
      ...remainingCols.slice(colAnchor),
    ]

    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder
      ? (() => {
          const orderWithoutGroup = table.metadata!.columnOrder!.filter(
            (n) => !groupColNamesBefore.has(n)
          )
          const firstGroupOrderIdx = table.metadata!.columnOrder!.findIndex((n) =>
            groupColNamesBefore.has(n)
          )
          const orderAnchor =
            firstGroupOrderIdx === -1 ? orderWithoutGroup.length : firstGroupOrderIdx
          return [
            ...orderWithoutGroup.slice(0, orderAnchor),
            ...orderedGroupColNames,
            ...orderWithoutGroup.slice(orderAnchor),
          ]
        })()
      : undefined

    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added output "${columnName}" (${newColDef.type}) to workflow group "${data.groupId}" in table ${data.tableId}`
    )

    const updatedTable: TableDefinition = {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
    return { updatedTable, newOutput }
  })

  // Backfill from saved execution logs — same flow `updateWorkflowGroup`
  // uses for added outputs. Reads each row's saved trace spans for the
  // group's executionId and writes the new output's value back. Existing
  // rows that have hand-edited values are left alone (overwrite: false).
  // Cheap compared to re-running the workflow on every row, which is what
  // an earlier version of this code did — that mistakenly fanned out N
  // workflow-group-cell jobs and burned compute the user didn't ask for.
  try {
    await backfillGroupOutputsFromLogs({
      table: updatedTable,
      groupId: data.groupId,
      outputs: [newOutput],
      overwrite: false,
      requestId,
    })
  } catch (err) {
    logger.warn(
      `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId} after adding output "${newOutput.columnName}":`,
      err
    )
  }

  return updatedTable
}

/**
 * Removes a single output from a workflow group. Drops the bound column and
 * strips the value from every row's `data` JSONB. If the output is the
 * group's last, the empty group is left in place — drop it explicitly with
 * `deleteWorkflowGroup` if needed.
 */
export async function deleteWorkflowGroupOutput(
  data: { tableId: string; groupId: string; columnName: string },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    if (!group.outputs.some((o) => o.columnName === data.columnName)) {
      throw new Error(
        `Workflow group "${data.groupId}" has no output bound to column "${data.columnName}"`
      )
    }

    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: group.outputs.filter((o) => o.columnName !== data.columnName),
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))
    const nextColumns = schema.columns.filter((c) => c.name !== data.columnName)
    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder?.filter((n) => n !== data.columnName)
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${data.columnName}::text WHERE table_id = ${data.tableId} AND data ? ${data.columnName}::text`
    )

    logger.info(
      `[${requestId}] Removed output "${data.columnName}" from workflow group "${data.groupId}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Removes a workflow group plus all its output columns. Also strips the
 * group's `executions[groupId]` entry from every row.
 */
export async function deleteWorkflowGroup(
  data: DeleteWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const group = groups.find((g) => g.id === data.groupId)
    if (!group) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }

    const removedColumnNames = new Set(group.outputs.map((o) => o.columnName))
    // Removed group's output columns may be referenced as deps by sibling groups.
    // Strip those refs so we don't leave dangling-column deps behind.
    const nextGroups = groups
      .filter((g) => g.id !== data.groupId)
      .map((g) => stripGroupDeps(g, removedColumnNames))
    const updatedSchema: TableSchema = {
      ...schema,
      columns: schema.columns.filter((c) => !removedColumnNames.has(c.name)),
      workflowGroups: nextGroups,
    }
    const updatedColumnOrder = table.metadata?.columnOrder?.filter(
      (n) => !removedColumnNames.has(n)
    )
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    for (const name of removedColumnNames) {
      await trx.execute(
        sql`UPDATE user_table_rows SET data = data - ${name}::text WHERE table_id = ${data.tableId} AND data ? ${name}::text`
      )
    }
    await stripGroupExecutions(trx, data.tableId, [data.groupId])

    logger.info(
      `[${requestId}] Deleted workflow group "${data.groupId}" from table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })
}

/** Minimal shape of a trace span we care about for backfill. */
interface BackfillTraceSpan {
  blockId?: string
  output?: Record<string, unknown>
  children?: BackfillTraceSpan[]
}

/** DFS the trace tree for the first span matching `blockId`. */
function findSpanByBlockId(
  spans: BackfillTraceSpan[] | undefined,
  blockId: string
): BackfillTraceSpan | undefined {
  if (!spans) return undefined
  for (const span of spans) {
    if (span.blockId === blockId) return span
    const child = findSpanByBlockId(span.children, blockId)
    if (child) return child
  }
  return undefined
}

/**
 * Walks completed group executions and pulls each target output's value out of
 * the workflow's saved trace spans, writing it back into row data. Used in two
 * spots:
 *
 *   - **added** outputs (new columns added to an existing group): `overwrite`
 *     is false, so rows with a hand-edited value already in the column are
 *     left alone.
 *   - **remapped** outputs (existing column re-pointed at a different
 *     `(blockId, path)`): `overwrite` is true — the new mapping is the source
 *     of truth, and the user expects the column to refresh to the new
 *     output's value rather than retain the stale old one.
 */
async function backfillGroupOutputsFromLogs(opts: {
  table: TableDefinition
  groupId: string
  outputs: WorkflowGroupOutput[]
  overwrite: boolean
  requestId: string
}): Promise<void> {
  const { table, groupId, outputs, overwrite, requestId } = opts
  if (outputs.length === 0) return

  const { pluckByPath } = await import('./pluck')

  // Find rows whose group execution completed and grab their executionId
  // directly from the sidecar — hits the (table_id, group_id) index, no
  // table scan over rowdata.
  const completedExecs = await db
    .select({
      rowId: tableRowExecutions.rowId,
      executionId: tableRowExecutions.executionId,
    })
    .from(tableRowExecutions)
    .where(
      and(
        eq(tableRowExecutions.tableId, table.id),
        eq(tableRowExecutions.groupId, groupId),
        eq(tableRowExecutions.status, 'completed')
      )
    )

  const executionIdsByRow = new Map<string, string>()
  for (const e of completedExecs) {
    if (!e.executionId) continue
    executionIdsByRow.set(e.rowId, e.executionId)
  }
  if (executionIdsByRow.size === 0) return

  const rowRecords = await db
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, table.id),
        inArray(userTableRows.id, Array.from(executionIdsByRow.keys()))
      )
    )

  const executionIds = Array.from(new Set(executionIdsByRow.values()))
  const logs = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.executionId, executionIds))

  const logByExecutionId = new Map<string, { traceSpans?: BackfillTraceSpan[] }>()
  // Heavy execution data may live in object storage; resolve pointers (bounded
  // concurrency) so trace spans are available for table-column enrichment.
  await mapWithConcurrency(logs, MATERIALIZE_CONCURRENCY, async (log) => {
    const executionData = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )
    logByExecutionId.set(
      log.executionId,
      (executionData as { traceSpans?: BackfillTraceSpan[] }) ?? {}
    )
  })

  const updates: Array<{ rowId: string; data: RowData }> = []
  for (const r of rowRecords) {
    const execId = executionIdsByRow.get(r.id)
    if (!execId) continue
    const log = logByExecutionId.get(execId)
    if (!log) continue

    const dataPatch: RowData = {}
    let mutated = false
    for (const out of outputs) {
      if (!overwrite && (r.data as RowData)[out.columnName] !== undefined) continue
      const span = findSpanByBlockId(log.traceSpans, out.blockId)
      if (!span?.output) continue
      const picked = pluckByPath(span.output, out.path)
      if (picked === undefined) continue
      dataPatch[out.columnName] = picked as RowData[string]
      mutated = true
    }
    if (!mutated) continue
    updates.push({ rowId: r.id, data: dataPatch })
  }

  if (updates.length === 0) return

  await batchUpdateRows(
    {
      tableId: table.id,
      updates,
      workspaceId: table.workspaceId,
    },
    table,
    requestId
  )

  logger.info(
    `[${requestId}] Backfilled ${updates.length} row(s) for group "${groupId}" in table ${table.id} (${overwrite ? 'remapped' : 'added'})`
  )
}

/**
 * Checks if a value is compatible with a target column type.
 */
function isValueCompatibleWithType(
  value: unknown,
  targetType: (typeof COLUMN_TYPES)[number]
): boolean {
  if (value === null || value === undefined) return true

  switch (targetType) {
    case 'string':
      return true
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'string') {
        const num = Number(value)
        return Number.isFinite(num) && value.trim() !== ''
      }
      return false
    }
    case 'boolean': {
      if (typeof value === 'boolean') return true
      if (typeof value === 'string')
        return ['true', 'false', '1', '0'].includes(value.toLowerCase())
      if (typeof value === 'number') return value === 0 || value === 1
      return false
    }
    case 'date': {
      if (value instanceof Date) return !Number.isNaN(value.getTime())
      if (typeof value === 'string') return !Number.isNaN(Date.parse(value))
      return false
    }
    case 'json':
      return true
    default:
      return false
  }
}
