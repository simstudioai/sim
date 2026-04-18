/**
 * Table service layer for internal programmatic access.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Note: API routes have their own implementations for HTTP-specific concerns.
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm'
import { getPostgresErrorCode } from '@/lib/core/utils/pg-error'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { generateId } from '@/lib/core/utils/uuid'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from './constants'
import { buildFilterClause, buildSortClause } from './sql'
import type {
  BatchInsertData,
  BatchUpdateByIdData,
  BulkDeleteByIdsData,
  BulkDeleteByIdsResult,
  BulkDeleteData,
  BulkOperationResult,
  BulkUpdateData,
  CreateTableData,
  DeleteColumnData,
  InsertRowData,
  QueryOptions,
  QueryResult,
  RenameColumnData,
  ReplaceRowsData,
  ReplaceRowsResult,
  RowData,
  TableDefinition,
  TableMetadata,
  TableRow,
  TableSchema,
  UpdateColumnConstraintsData,
  UpdateColumnTypeData,
  UpdateRowData,
  UpsertResult,
  UpsertRowData,
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

const logger = createLogger('TableService')

export class TableConflictError extends Error {
  readonly code = 'TABLE_EXISTS' as const
  constructor(name: string) {
    super(`A table named "${name}" already exists in this workspace`)
  }
}

export type TableScope = 'active' | 'archived' | 'all'

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
      rowCount: sql<number>`coalesce(${count(userTableRows.id)}, 0)`.mapWith(Number),
    })
    .from(userTableDefinitions)
    .leftJoin(userTableRows, eq(userTableRows.tableId, userTableDefinitions.id))
    .where(
      includeArchived
        ? eq(userTableDefinitions.id, tableId)
        : and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.archivedAt))
    )
    .groupBy(userTableDefinitions.id)
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
export async function countTables(workspaceId: string): Promise<number> {
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
      rowCount: sql<number>`coalesce(${count(userTableRows.id)}, 0)`.mapWith(Number),
    })
    .from(userTableDefinitions)
    .leftJoin(userTableRows, eq(userTableRows.tableId, userTableDefinitions.id))
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
    .groupBy(userTableDefinitions.id)
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
  column: { name: string; type: string; required?: boolean; unique?: boolean; position?: number },
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

  const newColumn = {
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

  const updatedSchema: TableSchema = { columns }

  const now = new Date()

  await db
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(eq(userTableDefinitions.id, tableId))

  logger.info(`[${requestId}] Added column "${column.name}" to table ${tableId}`)

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
 * Updates a table's UI metadata (e.g. column widths).
 * Does not update `updatedAt` since metadata is UI-only state.
 *
 * @param tableId - Table ID to update
 * @param metadata - New metadata object (merged with existing)
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

  // Atomic capacity check + insert inside a transaction.
  // FOR UPDATE on the table definition row serializes concurrent inserts,
  // preventing the TOCTOU race where multiple requests pass the count check.
  const [row] = await db.transaction(async (trx) => {
    await trx.execute(
      sql`SELECT 1 FROM user_table_definitions WHERE id = ${data.tableId} FOR UPDATE`
    )

    const [{ count: currentCount }] = await trx
      .select({ count: count() })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    if (Number(currentCount) >= table.maxRows) {
      throw new Error(`Table has reached maximum row limit (${table.maxRows})`)
    }

    let targetPosition: number

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
      const [{ maxPos }] = await trx
        .select({
          maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, data.tableId))

      targetPosition = maxPos + 1
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

  return {
    id: row.id,
    data: row.data as RowData,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
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
  // Validate all rows
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

  // Check unique constraints across all rows using optimized database query
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueResult = await checkBatchUniqueConstraintsDb(data.tableId, data.rows, table.schema)
    if (!uniqueResult.valid) {
      const errorMessages = uniqueResult.errors
        .map((e) => `Row ${e.row + 1}: ${e.errors.join(', ')}`)
        .join('; ')
      throw new Error(errorMessages)
    }
  }

  const now = new Date()

  // Atomic capacity check + insert inside a transaction.
  // FOR UPDATE on the table definition row serializes concurrent inserts.
  const insertedRows = await db.transaction(async (trx) => {
    await trx.execute(
      sql`SELECT 1 FROM user_table_definitions WHERE id = ${data.tableId} FOR UPDATE`
    )

    const [{ count: currentCount }] = await trx
      .select({ count: count() })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const remainingCapacity = table.maxRows - Number(currentCount)
    if (remainingCapacity < data.rows.length) {
      throw new Error(
        `Insufficient capacity. Can only insert ${remainingCapacity} more rows (table has ${Number(currentCount)}/${table.maxRows} rows)`
      )
    }

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

    if (data.positions && data.positions.length > 0) {
      // Position-aware insert: shift existing rows to create gaps, then insert.
      // Process positions ascending so each shift preserves gaps created by prior shifts.
      // (Descending would cause lower shifts to push higher gaps out of position.)
      const sortedPositions = [...data.positions].sort((a, b) => a - b)

      for (const pos of sortedPositions) {
        await trx
          .update(userTableRows)
          .set({ position: sql`position + 1` })
          .where(and(eq(userTableRows.tableId, data.tableId), gte(userTableRows.position, pos)))
      }

      // Build rows in original input order so RETURNING preserves caller's index correlation
      const rowsToInsert = data.rows.map((rowData, i) => buildRow(rowData, data.positions![i]))

      return trx.insert(userTableRows).values(rowsToInsert).returning()
    }

    const [{ maxPos }] = await trx
      .select({
        maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
      })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const rowsToInsert = data.rows.map((rowData, i) => buildRow(rowData, maxPos + 1 + i))

    return trx.insert(userTableRows).values(rowsToInsert).returning()
  })

  logger.info(`[${requestId}] Batch inserted ${data.rows.length} rows into table ${data.tableId}`)

  return insertedRows.map((r) => ({
    id: r.id,
    data: r.data as RowData,
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
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

  const result = await db.transaction(async (trx) => {
    await trx.execute(
      sql`SELECT 1 FROM user_table_definitions WHERE id = ${data.tableId} FOR UPDATE`
    )

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

    return { deletedCount: deletedRows.length, insertedCount }
  })

  logger.info(
    `[${requestId}] Replaced rows in table ${data.tableId}: deleted ${result.deletedCount}, inserted ${result.insertedCount}`
  )

  return result
}

/**
 * Upserts a row: updates an existing row if a match is found on the conflict target
 * column, otherwise inserts a new row.
 *
 * Uses a single unique column for matching (not OR across all unique columns) to avoid
 * ambiguous matches when multiple unique columns exist. Capacity checks run inside the
 * transaction with a FOR UPDATE lock to prevent TOCTOU races.
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

  // Validate column name before raw interpolation (defense-in-depth)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(targetColumnName)) {
    throw new Error(`Invalid column name: ${targetColumnName}`)
  }

  // Build the single-column match filter
  const matchFilter =
    typeof targetValue === 'string'
      ? sql`${userTableRows.data}->>${sql.raw(`'${targetColumnName}'`)} = ${String(targetValue)}`
      : sql`(${userTableRows.data}->${sql.raw(`'${targetColumnName}'`)})::jsonb = ${JSON.stringify(targetValue)}::jsonb`

  // Entire upsert runs in a transaction with FOR UPDATE lock on the table definition.
  // This serializes concurrent upserts and prevents the TOCTOU race on row count.
  const result = await db.transaction(async (trx) => {
    await trx.execute(
      sql`SELECT 1 FROM user_table_definitions WHERE id = ${data.tableId} FOR UPDATE`
    )

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

    if (existingRow) {
      const [updatedRow] = await trx
        .update(userTableRows)
        .set({
          data: data.data,
          updatedAt: now,
        })
        .where(eq(userTableRows.id, existingRow.id))
        .returning()

      return {
        row: {
          id: updatedRow.id,
          data: updatedRow.data as RowData,
          position: updatedRow.position,
          createdAt: updatedRow.createdAt,
          updatedAt: updatedRow.updatedAt,
        },
        operation: 'update' as const,
      }
    }

    // Check capacity atomically (inside the lock)
    const [{ count: currentCount }] = await trx
      .select({ count: count() })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    if (Number(currentCount) >= table.maxRows) {
      throw new Error(`Table row limit reached (${table.maxRows} rows max)`)
    }

    const [{ maxPos }] = await trx
      .select({
        maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
      })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const [insertedRow] = await trx
      .insert(userTableRows)
      .values({
        id: `row_${generateId().replace(/-/g, '')}`,
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        data: data.data,
        position: maxPos + 1,
        createdAt: now,
        updatedAt: now,
        ...(data.userId ? { createdBy: data.userId } : {}),
      })
      .returning()

    return {
      row: {
        id: insertedRow.id,
        data: insertedRow.data as RowData,
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

  return result
}

/**
 * Queries rows from a table with filtering, sorting, and pagination.
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
  const { filter, sort, limit = TABLE_LIMITS.DEFAULT_QUERY_LIMIT, offset = 0 } = options

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

  // Get total count
  const countResult = await db
    .select({ count: count() })
    .from(userTableRows)
    .where(whereClause ?? baseConditions)

  const totalCount = Number(countResult[0].count)

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
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
): Promise<TableRow> {
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

  await db
    .update(userTableRows)
    .set({ data: mergedData, updatedAt: now })
    .where(eq(userTableRows.id, data.rowId))

  logger.info(`[${requestId}] Updated row ${data.rowId} in table ${data.tableId}`)

  return {
    id: data.rowId,
    data: mergedData,
    position: existingRow.position,
    createdAt: existingRow.createdAt,
    updatedAt: now,
  }
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
  if (uniqueColumns.length > 0) {
    if (matchingRows.length > 1) {
      const uniqueColumnsInUpdate = uniqueColumns.filter((col) => col.name in data.data)
      if (uniqueColumnsInUpdate.length > 0) {
        throw new Error(
          `Cannot set unique column values when updating multiple rows. ` +
            `Columns with unique constraint: ${uniqueColumnsInUpdate.map((c) => c.name).join(', ')}. ` +
            `Updating ${matchingRows.length} rows with the same value would violate uniqueness.`
        )
      }
    }

    for (const row of matchingRows) {
      const existingData = row.data as RowData
      const mergedData = { ...existingData, ...data.data }
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
  }

  const now = new Date()

  await db.transaction(async (trx) => {
    for (let i = 0; i < matchingRows.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
      const batch = matchingRows.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
      const updatePromises = batch.map((row) => {
        const existingData = row.data as RowData
        return trx
          .update(userTableRows)
          .set({
            data: { ...existingData, ...data.data },
            updatedAt: now,
          })
          .where(eq(userTableRows.id, row.id))
      })
      await Promise.all(updatePromises)
    }
  })

  logger.info(`[${requestId}] Updated ${matchingRows.length} rows in table ${data.tableId}`)

  return {
    affectedCount: matchingRows.length,
    affectedRowIds: matchingRows.map((r) => r.id),
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
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, data.tableId),
        eq(userTableRows.workspaceId, data.workspaceId),
        inArray(userTableRows.id, rowIds)
      )
    )

  const existingMap = new Map(existingRows.map((r) => [r.id, r.data as RowData]))

  const missing = rowIds.filter((id) => !existingMap.has(id))
  if (missing.length > 0) {
    throw new Error(`Rows not found: ${missing.join(', ')}`)
  }

  const mergedUpdates: Array<{ rowId: string; mergedData: RowData }> = []
  for (const update of data.updates) {
    const existing = existingMap.get(update.rowId)!
    const merged = { ...existing, ...update.data }

    const sizeValidation = validateRowSize(merged)
    if (!sizeValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${sizeValidation.errors.join(', ')}`)
    }

    const schemaValidation = validateRowAgainstSchema(merged, table.schema)
    if (!schemaValidation.valid) {
      throw new Error(`Row ${update.rowId}: ${schemaValidation.errors.join(', ')}`)
    }

    mergedUpdates.push({ rowId: update.rowId, mergedData: merged })
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
    for (let i = 0; i < mergedUpdates.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
      const batch = mergedUpdates.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
      const updatePromises = batch.map(({ rowId, mergedData }) =>
        trx
          .update(userTableRows)
          .set({ data: mergedData, updatedAt: now })
          .where(eq(userTableRows.id, rowId))
      )
      await Promise.all(updatePromises)
    }
  })

  logger.info(`[${requestId}] Batch updated ${mergedUpdates.length} rows in table ${data.tableId}`)

  return {
    affectedCount: mergedUpdates.length,
    affectedRowIds: mergedUpdates.map((u) => u.rowId),
  }
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Recompacts row positions to be contiguous (0, 1, 2, ...) after batch deletions.
 * Single-row deletes use the more efficient `position - 1` shift in {@link deleteRow}.
 */
async function recompactPositions(tableId: string, trx: DbTransaction) {
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
    .select({ id: userTableRows.id })
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

  await db.transaction(async (trx) => {
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

    await recompactPositions(data.tableId, trx)
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
    const deleted: { id: string }[] = []
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
        .returning({ id: userTableRows.id })
      deleted.push(...rows)
    }

    await recompactPositions(data.tableId, trx)

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
  const updatedSchema: TableSchema = { columns: updatedColumns }

  const metadata = table.metadata as TableMetadata | null
  let updatedMetadata = metadata
  if (metadata?.columnWidths && actualOldName in metadata.columnWidths) {
    const { [actualOldName]: width, ...rest } = metadata.columnWidths
    updatedMetadata = { ...metadata, columnWidths: { ...rest, [data.newName]: width } }
  }

  const now = new Date()

  await db.transaction(async (trx) => {
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${actualOldName}::text || jsonb_build_object(${data.newName}::text, data->${sql.raw(`'${actualOldName.replace(/'/g, "''")}'`)}) WHERE table_id = ${data.tableId} AND data ? ${actualOldName}::text`
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

  const actualName = schema.columns[columnIndex].name
  const updatedSchema: TableSchema = {
    columns: schema.columns.filter((_, i) => i !== columnIndex),
  }

  const metadata = table.metadata as TableMetadata | null
  let updatedMetadata = metadata
  if (metadata?.columnWidths && actualName in metadata.columnWidths) {
    const { [actualName]: _, ...rest } = metadata.columnWidths
    updatedMetadata = { ...metadata, columnWidths: rest }
  }

  const now = new Date()

  await db.transaction(async (trx) => {
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${actualName}::text WHERE table_id = ${data.tableId} AND data ? ${actualName}::text`
    )
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

  const updatedSchema: TableSchema = { columns: remaining }

  const metadata = table.metadata as TableMetadata | null
  let updatedMetadata = metadata
  if (metadata?.columnWidths) {
    const widths = { ...metadata.columnWidths }
    for (const n of namesToDelete) delete widths[n]
    updatedMetadata = { ...metadata, columnWidths: widths }
  }

  const now = new Date()

  await db.transaction(async (trx) => {
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    for (const name of namesToDelete) {
      await trx.execute(
        sql`UPDATE user_table_rows SET data = data - ${name}::text WHERE table_id = ${data.tableId} AND data ? ${name}::text`
      )
    }
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

  const escapedName = column.name.replace(/'/g, "''")

  // Validate existing data is compatible with the new type
  const rows = await db
    .select({ id: userTableRows.id, data: userTableRows.data })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, data.tableId),
        sql`${userTableRows.data} ? ${column.name}`,
        sql`${userTableRows.data}->>${sql.raw(`'${escapedName}'`)} IS NOT NULL`
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
  const updatedSchema: TableSchema = { columns: updatedColumns }
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
  const escapedName = column.name.replace(/'/g, "''")

  if (data.required === true && !column.required) {
    const [result] = await db
      .select({ count: count() })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, data.tableId),
          sql`(NOT (${userTableRows.data} ? ${column.name}) OR ${userTableRows.data}->>${sql.raw(`'${escapedName}'`)} IS NULL)`
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
      sql`SELECT ${userTableRows.data}->>${sql.raw(`'${escapedName}'`)} AS val, count(*) AS cnt FROM ${userTableRows} WHERE table_id = ${data.tableId} AND ${userTableRows.data} ? ${column.name} AND ${userTableRows.data}->>${sql.raw(`'${escapedName}'`)} IS NOT NULL GROUP BY val HAVING count(*) > 1 LIMIT 1`
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
  const updatedSchema: TableSchema = { columns: updatedColumns }
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
