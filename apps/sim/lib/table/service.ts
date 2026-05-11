/**
 * Table service layer for internal programmatic access.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Note: API routes have their own implementations for HTTP-specific concerns.
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, gt, gte, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbOrTx } from '@/lib/db/types'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from './constants'
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
  getUniqueColumns,
  validateRowAgainstSchema,
  validateRowSize,
  validateTableName,
  validateTableSchema,
} from './validation'
import {
  assertValidSchema,
  scheduleRunsForRows,
  scheduleRunsForTable,
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
 * Serializes writers that compute `max(position) + 1` for the same table.
 *
 * The row-count trigger (migration 0198) serializes capacity via a row lock on
 * `user_table_definitions` — but it fires AFTER INSERT, so two concurrent
 * auto-positioned inserts can read the same snapshot and assign the same
 * position (the `(table_id, position)` index is non-unique). This advisory
 * lock restores the pre-trigger serialization scoped to a single table, with
 * no cross-table contention. Released automatically at COMMIT/ROLLBACK.
 */
async function acquireTablePositionLock(trx: DbTransaction, tableId: string) {
  await trx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))`
  )
}

/**
 * Returns the next auto-assigned `position` for a table (max(position) + 1, or 0
 * if empty). Callers must hold `acquireTablePositionLock` to avoid two concurrent
 * writers computing the same value against the same snapshot.
 */
async function nextAutoPosition(trx: DbTransaction, tableId: string): Promise<number> {
  const [{ maxPos }] = await trx
    .select({
      maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
    })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxPos + 1
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
export async function getTableById(
  tableId: string,
  options?: { includeArchived?: boolean }
): Promise<TableDefinition | null> {
  const { includeArchived = false } = options ?? {}
  const results = await db
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
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: table.schema as TableSchema,
    metadata: (table.metadata as TableMetadata) ?? null,
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
    createdBy: table.createdBy,
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
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

  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    schema: t.schema as TableSchema,
    metadata: (t.metadata as TableMetadata) ?? null,
    rowCount: t.rowCount,
    maxRows: t.maxRows,
    workspaceId: t.workspaceId,
    createdBy: t.createdBy,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))
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
        .select({ id: userTableDefinitions.id, archivedAt: userTableDefinitions.archivedAt })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, data.workspaceId),
            eq(userTableDefinitions.name, data.name)
          )
        )
        .limit(1)

      if (duplicateName.length > 0) {
        if (duplicateName[0].archivedAt) {
          throw new TableConflictError(data.name)
        }
        throw new TableConflictError(data.name)
      }

      await trx.insert(userTableDefinitions).values(newTable)

      const initialRowCount = data.initialRowCount ?? 0
      if (initialRowCount > 0) {
        const rowsToInsert = Array.from({ length: initialRowCount }, (_, i) => ({
          id: `row_${generateId().replace(/-/g, '')}`,
          tableId,
          data: {},
          position: i,
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
  const table = await getTableById(tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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

  await db
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

  const updatedSchema: TableSchema = { columns: [...table.schema.columns, ...additions] }
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

  await db
    .update(userTableDefinitions)
    .set({ metadata: merged })
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
  const schemaValidation = validateRowAgainstSchema(data.data, table.schema)
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
  const [row] = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)

    let targetPosition: number

    // The `(table_id, position)` index is non-unique, so we serialize all
    // position-aware writes (explicit and auto) through the per-table
    // advisory lock. Without this, two concurrent explicit-position inserts
    // at the same position can both observe an empty slot, both skip the
    // shift, and each INSERT a row with a duplicate `(table_id, position)`.
    await acquireTablePositionLock(trx, data.tableId)

    if (data.position !== undefined) {
      targetPosition = data.position

      const [existing] = await trx
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(
          and(eq(userTableRows.tableId, data.tableId), eq(userTableRows.position, targetPosition))
        )
        .limit(1)

      if (existing) {
        await trx
          .update(userTableRows)
          .set({ position: sql`position + 1` })
          .where(
            and(
              eq(userTableRows.tableId, data.tableId),
              gte(userTableRows.position, targetPosition)
            )
          )
      }
    } else {
      targetPosition = await nextAutoPosition(trx, data.tableId)
    }

    return trx
      .insert(userTableRows)
      .values({
        id: rowId,
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        data: data.data,
        position: targetPosition,
        createdAt: now,
        updatedAt: now,
        ...(data.userId ? { createdBy: data.userId } : {}),
      })
      .returning()
  })

  logger.info(`[${requestId}] Inserted row ${rowId} into table ${data.tableId}`)

  const insertedRow: TableRow = {
    id: row.id,
    data: row.data as RowData,
    executions: (row.executions as RowExecutions) ?? {},
    position: row.position,
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
  void scheduleRunsForRows(table, [insertedRow])

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
  return db.transaction((trx) => batchInsertRowsWithTx(trx, data, table, requestId))
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

    const schemaValidation = validateRowAgainstSchema(row, table.schema)
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

  const buildRow = (rowData: RowData, position: number) => ({
    id: `row_${generateId().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    position,
    createdAt: now,
    updatedAt: now,
    ...(data.userId ? { createdBy: data.userId } : {}),
  })

  await acquireTablePositionLock(trx, data.tableId)

  let insertedRows
  if (data.positions && data.positions.length > 0) {
    // Position-aware insert: shift existing rows to create gaps, then insert.
    // Process positions ascending so each shift preserves gaps created by prior shifts.
    const sortedPositions = [...data.positions].sort((a, b) => a - b)

    for (const pos of sortedPositions) {
      await trx
        .update(userTableRows)
        .set({ position: sql`position + 1` })
        .where(and(eq(userTableRows.tableId, data.tableId), gte(userTableRows.position, pos)))
    }

    const rowsToInsert = data.rows.map((rowData, i) => buildRow(rowData, data.positions![i]))
    insertedRows = await trx.insert(userTableRows).values(rowsToInsert).returning()
  } else {
    const startPos = await nextAutoPosition(trx, data.tableId)
    const rowsToInsert = data.rows.map((rowData, i) => buildRow(rowData, startPos + i))
    insertedRows = await trx.insert(userTableRows).values(rowsToInsert).returning()
  }

  logger.info(`[${requestId}] Batch inserted ${data.rows.length} rows into table ${data.tableId}`)

  const result: TableRow[] = insertedRows.map((r) => ({
    id: r.id,
    data: r.data as RowData,
    executions: (r.executions as RowExecutions) ?? {},
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))

  void fireTableTrigger(data.tableId, table.name, 'insert', result, null, table.schema, requestId)
  void scheduleRunsForRows(table, result)

  return result
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

    const schemaValidation = validateRowAgainstSchema(row, table.schema)
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
  await acquireTablePositionLock(trx, data.tableId)

  const deletedRows = await trx
    .delete(userTableRows)
    .where(eq(userTableRows.tableId, data.tableId))
    .returning({ id: userTableRows.id })

  let insertedCount = 0
  if (data.rows.length > 0) {
    const rowsToInsert = data.rows.map((rowData, i) => ({
      id: `row_${generateId().replace(/-/g, '')}`,
      tableId: data.tableId,
      workspaceId: data.workspaceId,
      data: rowData,
      position: i,
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

  const targetValue = data.data[targetColumnName]
  if (targetValue === undefined || targetValue === null) {
    throw new Error(`Upsert requires a value for the conflict target column "${targetColumnName}"`)
  }

  // Validate row data
  const sizeValidation = validateRowSize(data.data)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  const schemaValidation = validateRowAgainstSchema(data.data, schema)
  if (!schemaValidation.valid) {
    throw new Error(`Schema validation failed: ${schemaValidation.errors.join(', ')}`)
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
      await acquireTablePositionLock(trx, data.tableId)
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

      return {
        row: {
          id: updatedRow.id,
          data: updatedRow.data as RowData,
          executions: (updatedRow.executions as RowExecutions) ?? {},
          position: updatedRow.position,
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
        position: await nextAutoPosition(trx, data.tableId),
        createdAt: now,
        updatedAt: now,
        ...(data.userId ? { createdBy: data.userId } : {}),
      })
      .returning()

    return {
      row: {
        id: insertedRow.id,
        data: insertedRow.data as RowData,
        executions: (insertedRow.executions as RowExecutions) ?? {},
        position: insertedRow.position,
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
  void scheduleRunsForRows(table, [result.row])

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
 * @param tableId - Table ID to query
 * @param workspaceId - Workspace ID for access control
 * @param options - Query options (filter, sort, limit, offset)
 * @param requestId - Request ID for logging
 * @returns Query result with rows and pagination info
 */
export async function queryRows(
  tableId: string,
  workspaceId: string,
  options: QueryOptions,
  requestId: string
): Promise<QueryResult> {
  const {
    filter,
    sort,
    limit = TABLE_LIMITS.DEFAULT_QUERY_LIMIT,
    offset = 0,
    includeTotal = true,
  } = options

  const tableName = USER_TABLE_ROWS_SQL_NAME

  // Build WHERE clause
  const baseConditions = and(
    eq(userTableRows.tableId, tableId),
    eq(userTableRows.workspaceId, workspaceId)
  )

  let whereClause = baseConditions
  if (filter && Object.keys(filter).length > 0) {
    const filterClause = buildFilterClause(filter, tableName)
    if (filterClause) {
      whereClause = and(baseConditions, filterClause)
    }
  }

  let totalCount: number | null = null
  if (includeTotal) {
    const countResult = await db
      .select({ count: count() })
      .from(userTableRows)
      .where(whereClause ?? baseConditions)
    totalCount = Number(countResult[0].count)
  }

  // Build ORDER BY clause (default to position ASC for stable ordering)
  let orderByClause
  if (sort && Object.keys(sort).length > 0) {
    orderByClause = buildSortClause(sort, tableName)
  }

  // Execute query
  let query = db
    .select()
    .from(userTableRows)
    .where(whereClause ?? baseConditions)

  if (orderByClause) {
    query = query.orderBy(orderByClause) as typeof query
  } else {
    query = query.orderBy(userTableRows.position) as typeof query
  }

  const rows = await query.limit(limit).offset(offset)

  logger.info(
    `[${requestId}] Queried ${rows.length} rows from table ${tableId} (total: ${totalCount})`
  )

  return {
    rows: rows.map((r) => ({
      id: r.id,
      data: r.data as RowData,
      executions: (r.executions as RowExecutions) ?? {},
      position: r.position,
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
  return {
    id: row.id,
    data: row.data as RowData,
    executions: (row.executions as RowExecutions) ?? {},
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * When a user edit clears a workflow output column to empty, also clear the
 * exec record for that group. Without this, a `cancelled` (or `error`) exec
 * sticks on the row even after the user wipes the output, blocking the
 * auto-fire reactor (which respects terminal states). Treating the cleared
 * cell as "user wants this re-armed" matches the rule that cells are the
 * source of truth — we already do this for `completed` via
 * `areOutputsFilled` in the eligibility predicate; this extends the same
 * behavior to error/cancelled by making the data clear remove the exec.
 *
 * Returns a merged `executionsPatch` (caller's patch + null for groups whose
 * outputs were cleared), or the caller's patch unchanged if nothing applies.
 */
function deriveExecClearsForDataPatch(
  dataPatch: RowData,
  schema: TableSchema,
  callerPatch: Record<string, RowExecutionMetadata | null> | undefined
): Record<string, RowExecutionMetadata | null> | undefined {
  const groupsToClear = new Set<string>()
  for (const [columnName, value] of Object.entries(dataPatch)) {
    const cleared = value === null || value === undefined || value === ''
    if (!cleared) continue
    const col = schema.columns.find((c) => c.name === columnName)
    if (col?.workflowGroupId) groupsToClear.add(col.workflowGroupId)
  }
  if (groupsToClear.size === 0) return callerPatch
  const merged: Record<string, RowExecutionMetadata | null> = { ...(callerPatch ?? {}) }
  for (const gid of groupsToClear) {
    if (!(gid in merged)) merged[gid] = null
  }
  return merged
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
 * Builds a SQL expression that applies the given `executionsPatch` to the
 * row's `executions` jsonb in-place — set keys for non-null values, delete
 * keys for `null` values. Returns null when the patch is empty/missing.
 *
 * Why server-side: read-modify-write on the entire jsonb blob races between
 * concurrent writers (e.g., a column edit and a manual-retry stamp), so the
 * last writer wins for keys it didn't touch and clobbers other writers'
 * exec updates. Patching keys at the SQL level keeps each writer's changes
 * atomic per-key.
 */
function buildExecutionsSqlPatch(
  patch: Record<string, RowExecutionMetadata | null> | undefined
): SQL | null {
  if (!patch) return null
  const entries = Object.entries(patch)
  if (entries.length === 0) return null

  let expr: SQL = sql`coalesce(${userTableRows.executions}, '{}'::jsonb)`
  for (const [gid, value] of entries) {
    if (value === null) {
      expr = sql`(${expr}) - ${gid}::text`
    } else {
      expr = sql`(${expr}) || jsonb_build_object(${gid}::text, ${JSON.stringify(value)}::jsonb)`
    }
  }
  return expr
}

/**
 * Strips the given workflow group ids from every row's `executions` jsonb on
 * a table — used by the column / group delete paths so stale running/queued
 * exec records don't linger and inflate counters after the group is gone.
 * The caller wraps in their own transaction.
 */
async function stripGroupExecutions(
  trx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tableId: string,
  groupIds: Iterable<string>
): Promise<void> {
  for (const gid of groupIds) {
    await trx.execute(
      sql`UPDATE user_table_rows SET executions = executions - ${gid}::text WHERE table_id = ${tableId} AND executions ? ${gid}::text`
    )
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
  // Auto-clear exec records for workflow output columns the user just wiped,
  // so the auto-fire reactor sees no exec and re-arms the cell.
  const effectiveExecutionsPatch = deriveExecClearsForDataPatch(
    data.data,
    table.schema,
    data.executionsPatch
  )
  const mergedExecutions = applyExecutionsPatch(existingRow.executions, effectiveExecutionsPatch)

  // Validate size
  const sizeValidation = validateRowSize(mergedData)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  // Validate against schema
  const schemaValidation = validateRowAgainstSchema(mergedData, table.schema)
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

  // Cell-task partial writes pass `cancellationGuard` so the SQL update is a
  // no-op when (a) a stop click already wrote `cancelled` for this run, or
  // (b) a newer run has taken over the cell with a different executionId. The
  // worker is "this run's writes only land if this run is still the active
  // run on the cell." Authoritative cancel writes from `cancelWorkflowGroupRuns`
  // skip the guard entirely (they don't pass `cancellationGuard`).
  //
  // SQL-level for atomicity: an in-process read + update would race a
  // concurrent stop or rerun. The two clauses are joined by AND because
  // either failing means the worker is no longer authoritative.
  const guard = data.cancellationGuard
  const whereClause = guard
    ? and(
        eq(userTableRows.id, data.rowId),
        // Reject writes that would land on top of an already-`cancelled` state
        // for this same run. Wrapped in IS DISTINCT FROM so a missing exec
        // (NULL) cleanly evaluates as "different" rather than NULL-poisoning.
        sql`(executions->${guard.groupId}->>'status' IS DISTINCT FROM 'cancelled' OR executions->${guard.groupId}->>'executionId' IS DISTINCT FROM ${guard.executionId})`,
        // Reject writes from a stale worker — the cell's active run has moved
        // on. `OR exec IS NULL` lets the worker land its first `running`
        // stamp on a row that has no prior exec record (initial stamp from
        // the scheduler may not have committed yet).
        sql`(executions->${guard.groupId} IS NULL OR executions->${guard.groupId}->>'executionId' = ${guard.executionId})`
      )
    : eq(userTableRows.id, data.rowId)

  // Apply the executions patch at the SQL level — we never overwrite the full
  // executions blob, only the keys the caller explicitly patched. Without
  // this, concurrent updateRow calls (e.g., a column edit and a manual
  // retry's stamp) would each compute `mergedExecutions` from their own
  // in-memory snapshot and the last writer wins, clobbering the other's
  // exec keys. The data field still does last-writer-wins because that's
  // the user's edit, but exec records are independently keyed by groupId.
  const executionsExpr = buildExecutionsSqlPatch(effectiveExecutionsPatch)
  const updated = await db
    .update(userTableRows)
    .set({
      data: mergedData,
      ...(executionsExpr ? { executions: executionsExpr } : {}),
      updatedAt: now,
    })
    .where(whereClause)
    .returning({ id: userTableRows.id })

  // Only meaningful when a guard is set — `null` signals "guard rejected".
  if (guard && updated.length === 0) {
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
  // Awaited (not `void`) so cell tasks dispatch their cascade before the
  // trigger.dev worker tears down on `run()` resolve.
  if (!data.skipScheduler) await scheduleRunsForRows(table, [updatedRow])

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
  await db.transaction(async (trx) => {
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

    if (!deleted) throw new Error('Row not found')

    await trx
      .update(userTableRows)
      .set({ position: sql`position - 1` })
      .where(and(eq(userTableRows.tableId, tableId), gt(userTableRows.position, deleted.position)))
  })

  logger.info(`[${requestId}] Deleted row ${rowId} from table ${tableId}`)
}

/**
 * Updates multiple rows matching a filter.
 *
 * @param data - Bulk update data
 * @param table - Table definition
 * @param requestId - Request ID for logging
 * @returns Bulk operation result
 */
export async function updateRowsByFilter(
  data: BulkUpdateData,
  table: TableDefinition,
  requestId: string
): Promise<BulkOperationResult> {
  const tableName = USER_TABLE_ROWS_SQL_NAME

  const filterClause = buildFilterClause(data.filter, tableName)
  if (!filterClause) {
    throw new Error('Filter is required for bulk update')
  }

  const baseConditions = and(
    eq(userTableRows.tableId, data.tableId),
    eq(userTableRows.workspaceId, data.workspaceId)
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

  for (const row of matchingRows) {
    const existingData = row.data as RowData
    const mergedData = { ...existingData, ...data.data }

    const sizeValidation = validateRowSize(mergedData)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${row.id}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = validateRowAgainstSchema(mergedData, table.schema)
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
      data.tableId,
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

  logger.info(`[${requestId}] Updated ${matchingRows.length} rows in table ${data.tableId}`)

  const oldRows = new Map(matchingRows.map((r) => [r.id, r.data as RowData]))
  const updatedRows: TableRow[] = matchingRows.map((r) => ({
    id: r.id,
    data: { ...(r.data as RowData), ...data.data },
    executions: ((r as { executions?: unknown }).executions as RowExecutions) ?? {},
    position: 0,
    createdAt: now,
    updatedAt: now,
  }))
  void fireTableTrigger(
    data.tableId,
    table.name,
    'update',
    updatedRows,
    oldRows,
    table.schema,
    requestId
  )
  void scheduleRunsForRows(table, updatedRows)

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
      executions: userTableRows.executions,
    })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, data.tableId),
        eq(userTableRows.workspaceId, data.workspaceId),
        inArray(userTableRows.id, rowIds)
      )
    )

  type ExistingRow = { data: RowData; executions: RowExecutions }
  const existingMap = new Map<string, ExistingRow>(
    existingRows.map((r) => [
      r.id,
      { data: r.data as RowData, executions: (r.executions as RowExecutions) ?? {} },
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
  }> = []
  for (const update of data.updates) {
    const existing = existingMap.get(update.rowId)!
    const merged = { ...existing.data, ...update.data }
    // Auto-clear exec records for workflow output columns the user just
    // wiped — same rationale as `updateRow`.
    const effectiveExecutionsPatch = deriveExecClearsForDataPatch(
      update.data,
      table.schema,
      update.executionsPatch
    )
    const mergedExecutions = applyExecutionsPatch(existing.executions, effectiveExecutionsPatch)

    const sizeValidation = validateRowSize(merged)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = validateRowAgainstSchema(merged, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${schemaValidation.errors.join(', ')}`)
    }

    mergedUpdates.push({
      rowId: update.rowId,
      mergedData: merged,
      mergedExecutions,
      executionsPatch: effectiveExecutionsPatch,
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
      // Same as `updateRow`: patch executions at the SQL level when a patch
      // is set, so concurrent writers don't clobber each other's keys via
      // last-writer-wins on the full jsonb blob.
      const updatePromises = batch.map(({ rowId, mergedData, executionsPatch }) => {
        const executionsExpr = buildExecutionsSqlPatch(executionsPatch)
        return trx
          .update(userTableRows)
          .set({
            data: mergedData,
            ...(executionsExpr ? { executions: executionsExpr } : {}),
            updatedAt: now,
          })
          .where(eq(userTableRows.id, rowId))
      })
      await Promise.all(updatePromises)
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
  if (!data.skipScheduler) void scheduleRunsForRows(table, updatedRowsForTrigger)

  return {
    affectedCount: mergedUpdates.length,
    affectedRowIds: mergedUpdates.map((u) => u.rowId),
  }
}

/**
 * Recompacts row positions to be contiguous after batch deletions.
 *
 * When `minDeletedPos` is provided, only rows with `position >= minDeletedPos`
 * are re-numbered (starting from `minDeletedPos`). Rows before the earliest
 * deleted position are untouched since their position is unaffected.
 *
 * If `minDeletedPos` is omitted, the whole table is recompacted from 0.
 * Single-row deletes use the more efficient `position - 1` shift in {@link deleteRow}.
 */
async function recompactPositions(tableId: string, trx: DbTransaction, minDeletedPos?: number) {
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

/**
 * Deletes multiple rows matching a filter.
 *
 * @param data - Bulk delete data
 * @param requestId - Request ID for logging
 * @returns Bulk operation result
 */
export async function deleteRowsByFilter(
  data: BulkDeleteData,
  requestId: string
): Promise<BulkOperationResult> {
  const tableName = USER_TABLE_ROWS_SQL_NAME

  // Build filter clause
  const filterClause = buildFilterClause(data.filter, tableName)
  if (!filterClause) {
    throw new Error('Filter is required for bulk delete')
  }

  // Find matching rows
  const baseConditions = and(
    eq(userTableRows.tableId, data.tableId),
    eq(userTableRows.workspaceId, data.workspaceId)
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
  const minDeletedPos = matchingRows.reduce(
    (min, r) => (r.position < min ? r.position : min),
    matchingRows[0].position
  )

  await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
      const batch = rowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
      await trx.delete(userTableRows).where(
        and(
          eq(userTableRows.tableId, data.tableId),
          eq(userTableRows.workspaceId, data.workspaceId),
          sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
            batch.map((id) => sql`${id}`),
            sql`, `
          )}])`
        )
      )
    }

    await recompactPositions(data.tableId, trx, minDeletedPos)
  })

  logger.info(`[${requestId}] Deleted ${matchingRows.length} rows from table ${data.tableId}`)

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

  const deletedRows = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    const deleted: { id: string; position: number }[] = []
    for (let i = 0; i < uniqueRequestedRowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
      const batch = uniqueRequestedRowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
      const rows = await trx
        .delete(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, data.tableId),
            eq(userTableRows.workspaceId, data.workspaceId),
            sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
              batch.map((id) => sql`${id}`),
              sql`, `
            )}])`
          )
        )
        .returning({ id: userTableRows.id, position: userTableRows.position })
      deleted.push(...rows)
    }

    if (deleted.length > 0) {
      const minDeletedPos = deleted.reduce(
        (min, r) => (r.position < min ? r.position : min),
        deleted[0].position
      )
      await recompactPositions(data.tableId, trx, minDeletedPos)
    }

    return deleted
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
  // Cascade rename into every workflow group: its output `columnName` refs
  // and its `dependencies.columns` entries.
  const updatedGroups = (schema.workflowGroups ?? []).map((group) => {
    const renamedOutputs = group.outputs.map((o) =>
      o.columnName === actualOldName ? { ...o, columnName: data.newName } : o
    )
    const renamedDeps = group.dependencies?.columns?.map((d) =>
      d === actualOldName ? data.newName : d
    )
    return {
      ...group,
      outputs: renamedOutputs,
      ...(renamedDeps ? { dependencies: { columns: renamedDeps } } : {}),
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
      columnOrder: updatedMetadata.columnOrder.map((n) => (n === actualOldName ? data.newName : n)),
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

  await db.transaction(async (trx) => {
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
  })

  logger.info(
    `[${requestId}] Renamed column "${actualOldName}" to "${data.newName}" in table ${data.tableId}`
  )

  return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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

  await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${actualName}::text WHERE table_id = ${data.tableId} AND data ? ${actualName}::text`
    )
    if (groupRemovedId) await stripGroupExecutions(trx, data.tableId, [groupRemovedId])
  })

  logger.info(`[${requestId}] Deleted column "${actualName}" from table ${data.tableId}`)

  return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
}

/**
 * Deletes multiple columns from a table in a single transaction.
 * Avoids the race condition of calling deleteColumn multiple times in parallel.
 */
export async function deleteColumns(
  data: { tableId: string; columnNames: string[] },
  requestId: string
): Promise<TableDefinition> {
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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

  await db.transaction(async (trx) => {
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
  })

  logger.info(
    `[${requestId}] Deleted columns [${[...namesToDelete].join(', ')}] from table ${data.tableId}`
  )

  return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
  const rows = await db
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

  await db
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(eq(userTableDefinitions.id, data.tableId))

  logger.info(
    `[${requestId}] Changed column "${column.name}" type from "${column.type}" to "${data.newType}" in table ${data.tableId}`
  )

  return { ...table, schema: updatedSchema, updatedAt: now }
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
    const [result] = await db
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
    const duplicates = (await db.execute(
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

  await db
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(eq(userTableDefinitions.id, data.tableId))

  logger.info(
    `[${requestId}] Updated constraints for column "${column.name}" in table ${data.tableId}`
  )

  return { ...table, schema: updatedSchema, updatedAt: now }
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
  await db
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
    .where(eq(userTableDefinitions.id, data.tableId))

  logger.info(
    `[${requestId}] Added workflow group "${data.group.id}" with ${data.outputColumns.length} output column(s) to table ${data.tableId}`
  )

  const updatedTable: TableDefinition = {
    ...table,
    schema: updatedSchema,
    metadata: updatedMetadata,
    updatedAt: now,
  }

  // Schedule existing rows so already-filled deps trigger immediately. Skipped
  // when the caller opted out (Mothership stages groups silently — `autoRun:
  // false` — so the AI can compose multiple changes without firing rows mid-edit).
  // Awaited (not `void`) so the response includes the queued exec state — the
  // client's post-mutation refetch otherwise lands before the stamps commit
  // and the rows query polling never starts.
  if (data.autoRun !== false) {
    try {
      await scheduleRunsForTable(updatedTable)
    } catch (err) {
      logger.error(`[${requestId}] Failed to schedule runs after group add:`, err)
    }
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
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
  const mappingUpdates = data.mappingUpdates ?? []
  const remappedColumnNames = new Set<string>()
  // Per-column type override resolved from the new mapping's leaf type. Only
  // populated when a remap actually changes the column's type — keeps the
  // schema patch a no-op when the user repoints to an output of the same
  // type. Falls back to leaving the existing type alone if the workflow or
  // its target output can't be resolved (workflow deleted, block removed).
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

    // Resolve the new leaf type for each remap so the column's declared type
    // matches what the new mapping produces. Without this, a string→number
    // remap would keep `type: 'string'` and validateRowAgainstSchema would
    // reject every backfilled value.
    try {
      const [
        { loadWorkflowFromNormalizedTables },
        { flattenWorkflowOutputs },
        { columnTypeForLeaf },
      ] = await Promise.all([
        import('@/lib/workflows/persistence/utils'),
        import('@/lib/workflows/blocks/flatten-outputs'),
        import('./column-naming'),
      ])
      const targetWorkflowId = data.workflowId ?? group.workflowId
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
        const colByName = new Map(schema.columns.map((c) => [c.name, c]))
        for (const u of mappingUpdates) {
          const match = flatByKey.get(`${u.blockId}::${u.path}`)
          if (!match) continue
          const newType = columnTypeForLeaf(match.leafType)
          const oldType = colByName.get(u.columnName)?.type
          if (newType && newType !== oldType) {
            remappedColumnTypes.set(u.columnName, newType)
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

  // If the caller passed `outputs`, that's the new full set. If only
  // `mappingUpdates` was sent, the new set is the remapped old set.
  const newOutputs = data.outputs ?? oldOutputs
  const oldKey = (o: WorkflowGroupOutput) => `${o.blockId}::${o.path}`
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
  let updatedColumnOrder = table.metadata?.columnOrder?.filter((n) => !removedColumnNames.has(n))
  if (updatedColumnOrder && newColDefs.length > 0) {
    const newColNamesLower = new Set(newColDefs.map((c) => c.name.toLowerCase()))
    const orderWithoutNew = updatedColumnOrder.filter((n) => !newColNamesLower.has(n.toLowerCase()))
    const groupColNames = new Set(newOutputs.map((o) => o.columnName))
    const orderedGroupNames = newOutputs.map((o) => o.columnName)
    const firstGroupOrderIdx = orderWithoutNew.findIndex((n) => groupColNames.has(n))
    const anchorOrderIdx = firstGroupOrderIdx === -1 ? orderWithoutNew.length : firstGroupOrderIdx
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
  await db.transaction(async (trx) => {
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
  })

  logger.info(
    `[${requestId}] Updated workflow group "${data.groupId}" in table ${data.tableId} (added=${added.length}, removed=${removed.length}, remapped=${remappedColumnNames.size})`
  )

  const updatedTable: TableDefinition = {
    ...table,
    schema: updatedSchema,
    metadata: updatedMetadata,
    updatedAt: now,
  }

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

  // autoRun toggled false → true: fire deps-satisfied rows now. Mirrors the
  // post-add scheduling path so re-enabling auto-fire doesn't require manual
  // run clicks for rows that are already eligible. Awaited so the post-
  // mutation refetch sees the queued exec stamps.
  if (group.autoRun === false && data.autoRun === true) {
    try {
      await scheduleRunsForTable(updatedTable, { groupId: data.groupId })
    } catch (err) {
      logger.error(`[${requestId}] Failed to schedule runs after autoRun toggled on:`, err)
    }
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
  const table = await getTableById(data.tableId)
  if (!table) throw new Error('Table not found')

  const schema = table.schema
  const groups = schema.workflowGroups ?? []
  const groupIndex = groups.findIndex((g) => g.id === data.groupId)
  if (groupIndex === -1) {
    throw new Error(`Workflow group "${data.groupId}" not found`)
  }
  const group = groups[groupIndex]

  if (group.outputs.some((o) => o.blockId === data.blockId && o.path === data.path)) {
    throw new Error(
      `Workflow group "${data.groupId}" already has an output at ${data.blockId}::${data.path}`
    )
  }

  const [
    { loadWorkflowFromNormalizedTables },
    { flattenWorkflowOutputs, getBlockExecutionOrder },
    { columnTypeForLeaf, deriveOutputColumnName },
  ] = await Promise.all([
    import('@/lib/workflows/persistence/utils'),
    import('@/lib/workflows/blocks/flatten-outputs'),
    import('./column-naming'),
  ])
  const normalized = await loadWorkflowFromNormalizedTables(group.workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${group.workflowId} not found`)
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
      `Output ${data.blockId}::${data.path} is not a valid pickable output on workflow ${group.workflowId}`
    )
  }
  const distances = getBlockExecutionOrder(blocks, normalized.edges ?? [])
  const flatIndex = new Map(flattened.map((f, i) => [`${f.blockId}::${f.path}`, i]))

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
    type: columnTypeForLeaf(match.leafType),
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
  await db
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
    .where(eq(userTableDefinitions.id, data.tableId))

  logger.info(
    `[${requestId}] Added output "${columnName}" (${newColDef.type}) to workflow group "${data.groupId}" in table ${data.tableId}`
  )

  // Backfill from saved execution logs — same flow `updateWorkflowGroup`
  // uses for added outputs. Reads each row's saved trace spans for the
  // group's executionId and writes the new output's value back. Existing
  // rows that have hand-edited values are left alone (overwrite: false).
  // Cheap compared to re-running the workflow on every row, which is what
  // an earlier version of this code did — that mistakenly fanned out N
  // workflow-group-cell jobs and burned compute the user didn't ask for.
  const updatedTable: TableDefinition = {
    ...table,
    schema: updatedSchema,
    metadata: updatedMetadata,
    updatedAt: now,
  }
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
      `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId} after adding output "${columnName}":`,
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
  const table = await getTableById(data.tableId)
  if (!table) throw new Error('Table not found')

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
  await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${data.columnName}::text WHERE table_id = ${data.tableId} AND data ? ${data.columnName}::text`
    )
  })

  logger.info(
    `[${requestId}] Removed output "${data.columnName}" from workflow group "${data.groupId}" in table ${data.tableId}`
  )

  return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
}

/**
 * Removes a workflow group plus all its output columns. Also strips the
 * group's `executions[groupId]` entry from every row.
 */
export async function deleteWorkflowGroup(
  data: DeleteWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const table = await getTableById(data.tableId)
  if (!table) {
    throw new Error('Table not found')
  }

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
  const updatedColumnOrder = table.metadata?.columnOrder?.filter((n) => !removedColumnNames.has(n))
  assertValidSchema(updatedSchema, updatedColumnOrder)

  const updatedMetadata: TableMetadata | null =
    updatedColumnOrder && table.metadata
      ? { ...table.metadata, columnOrder: updatedColumnOrder }
      : table.metadata
        ? { ...table.metadata }
        : null

  const now = new Date()
  await db.transaction(async (trx) => {
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
  })

  logger.info(`[${requestId}] Deleted workflow group "${data.groupId}" from table ${data.tableId}`)

  return {
    ...table,
    schema: updatedSchema,
    metadata: updatedMetadata,
    updatedAt: now,
  }
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

  const rowRecords = await db
    .select()
    .from(userTableRows)
    .where(eq(userTableRows.tableId, table.id))

  // Collect unique executionIds across rows whose group execution completed.
  const executionIdsByRow = new Map<string, string>()
  for (const r of rowRecords) {
    const exec = (r.executions as RowExecutions)?.[groupId]
    if (!exec || exec.status !== 'completed' || !exec.executionId) continue
    executionIdsByRow.set(r.id, exec.executionId)
  }
  if (executionIdsByRow.size === 0) return

  const executionIds = Array.from(new Set(executionIdsByRow.values()))
  const logs = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.executionId, executionIds))

  const logByExecutionId = new Map<string, { traceSpans?: BackfillTraceSpan[] }>()
  for (const log of logs) {
    logByExecutionId.set(
      log.executionId,
      (log.executionData as { traceSpans?: BackfillTraceSpan[] }) ?? {}
    )
  }

  const updates: Array<{ rowId: string; data: RowData }> = []
  for (const r of rowRecords) {
    const exec = (r.executions as RowExecutions)?.[groupId]
    if (!exec?.executionId) continue
    const log = logByExecutionId.get(exec.executionId)
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
