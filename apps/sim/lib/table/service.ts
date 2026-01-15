/**
 * Table service layer for business logic operations.
 *
 * This module provides the core business logic for user-defined tables,
 * extracted from API route handlers for better testability and reuse.
 *
 * @module lib/table/service
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, sql } from 'drizzle-orm'
import { TABLE_LIMITS } from './constants'
import { buildFilterClause, buildSortClause } from './query-builder'
import type {
  BatchInsertData,
  BulkDeleteData,
  BulkOperationResult,
  BulkUpdateData,
  CreateTableData,
  InsertRowData,
  QueryOptions,
  QueryResult,
  RowData,
  TableDefinition,
  TableRow,
  TableSchema,
  UpdateRowData,
} from './types'
import {
  getUniqueColumns,
  validateRowAgainstSchema,
  validateRowSize,
  validateTableName,
  validateTableSchema,
  validateUniqueConstraints,
} from './validation'

const logger = createLogger('TableService')

async function getTableRowCount(tableId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))

  return Number(result?.count ?? 0)
}

/**
 * Gets a table by ID with full details.
 *
 * @param tableId - Table ID to fetch
 * @returns Table definition or null if not found
 */
export async function getTableById(tableId: string): Promise<TableDefinition | null> {
  const results = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  if (results.length === 0) return null

  const table = results[0]
  const rowCount = await getTableRowCount(tableId)
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: table.schema as TableSchema,
    rowCount,
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
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
export async function listTables(workspaceId: string): Promise<TableDefinition[]> {
  const tables = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, workspaceId))
    .orderBy(userTableDefinitions.createdAt)

  const rowCounts = await db
    .select({
      tableId: userTableRows.tableId,
      rowCount: count(),
    })
    .from(userTableRows)
    .where(eq(userTableRows.workspaceId, workspaceId))
    .groupBy(userTableRows.tableId)

  const rowCountByTable = new Map(rowCounts.map((row) => [row.tableId, Number(row.rowCount ?? 0)]))

  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    schema: t.schema as TableSchema,
    rowCount: rowCountByTable.get(t.id) ?? 0,
    maxRows: t.maxRows,
    workspaceId: t.workspaceId,
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

  // Check workspace table limit
  const existingCount = await db
    .select({ count: count() })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, data.workspaceId))

  if (existingCount[0].count >= TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE) {
    throw new Error(
      `Workspace has reached maximum table limit (${TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE})`
    )
  }

  // Check for duplicate name
  const duplicateName = await db
    .select({ id: userTableDefinitions.id })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, data.workspaceId),
        eq(userTableDefinitions.name, data.name)
      )
    )
    .limit(1)

  if (duplicateName.length > 0) {
    throw new Error(`Table with name "${data.name}" already exists in this workspace`)
  }

  const tableId = `tbl_${crypto.randomUUID().replace(/-/g, '')}`
  const now = new Date()

  const newTable = {
    id: tableId,
    name: data.name,
    description: data.description ?? null,
    schema: data.schema,
    workspaceId: data.workspaceId,
    createdBy: data.userId,
    maxRows: TABLE_LIMITS.MAX_ROWS_PER_TABLE,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(userTableDefinitions).values(newTable)

  logger.info(`[${requestId}] Created table ${tableId} in workspace ${data.workspaceId}`)

  return {
    id: newTable.id,
    name: newTable.name,
    description: newTable.description,
    schema: newTable.schema as TableSchema,
    rowCount: 0,
    maxRows: newTable.maxRows,
    workspaceId: newTable.workspaceId,
    createdAt: newTable.createdAt,
    updatedAt: newTable.updatedAt,
  }
}

/**
 * Deletes a table (hard delete).
 *
 * @param tableId - Table ID to delete
 * @param requestId - Request ID for logging
 */
export async function deleteTable(tableId: string, requestId: string): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.delete(userTableRows).where(eq(userTableRows.tableId, tableId))
    await trx.delete(userTableDefinitions).where(eq(userTableDefinitions.id, tableId))
  })

  logger.info(`[${requestId}] Deleted table ${tableId}`)
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
  const rowCount = await getTableRowCount(data.tableId)

  // Check capacity
  if (rowCount >= table.maxRows) {
    throw new Error(`Table has reached maximum row limit (${table.maxRows})`)
  }

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

  // Check unique constraints
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const existingRows = await db
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const uniqueValidation = validateUniqueConstraints(
      data.data,
      table.schema,
      existingRows.map((r) => ({ id: r.id, data: r.data as RowData }))
    )
    if (!uniqueValidation.valid) {
      throw new Error(uniqueValidation.errors.join(', '))
    }
  }

  const rowId = `row_${crypto.randomUUID().replace(/-/g, '')}`
  const now = new Date()

  const newRow = {
    id: rowId,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: data.data,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(userTableRows).values(newRow)

  logger.info(`[${requestId}] Inserted row ${rowId} into table ${data.tableId}`)

  return {
    id: newRow.id,
    data: newRow.data as RowData,
    createdAt: newRow.createdAt,
    updatedAt: newRow.updatedAt,
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
  const currentRowCount = await getTableRowCount(data.tableId)

  // Check capacity
  const remainingCapacity = table.maxRows - currentRowCount
  if (remainingCapacity < data.rows.length) {
    throw new Error(
      `Insufficient capacity. Can only insert ${remainingCapacity} more rows (table has ${currentRowCount}/${table.maxRows} rows)`
    )
  }

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

  // Check unique constraints across all rows
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const existingRows = await db
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const allRows = existingRows.map((r) => ({ id: r.id, data: r.data as RowData }))

    for (let i = 0; i < data.rows.length; i++) {
      const uniqueValidation = validateUniqueConstraints(data.rows[i], table.schema, allRows)
      if (!uniqueValidation.valid) {
        throw new Error(`Row ${i + 1}: ${uniqueValidation.errors.join(', ')}`)
      }
      // Add to allRows for checking subsequent rows in batch
      allRows.push({ id: `pending_${i}`, data: data.rows[i] })
    }
  }

  const now = new Date()
  const rowsToInsert = data.rows.map((rowData) => ({
    id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    createdAt: now,
    updatedAt: now,
  }))

  await db.insert(userTableRows).values(rowsToInsert)

  logger.info(`[${requestId}] Batch inserted ${data.rows.length} rows into table ${data.tableId}`)

  return rowsToInsert.map((r) => ({
    id: r.id,
    data: r.data as RowData,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
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

  const tableName = 'user_table_rows'

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

  // Build ORDER BY clause
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
  }

  const rows = await query.limit(limit).offset(offset)

  logger.info(
    `[${requestId}] Queried ${rows.length} rows from table ${tableId} (total: ${totalCount})`
  )

  return {
    rows: rows.map((r) => ({
      id: r.id,
      data: r.data as RowData,
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

  // Validate size
  const sizeValidation = validateRowSize(data.data)
  if (!sizeValidation.valid) {
    throw new Error(sizeValidation.errors.join(', '))
  }

  // Validate against schema
  const schemaValidation = validateRowAgainstSchema(data.data, table.schema)
  if (!schemaValidation.valid) {
    throw new Error(`Schema validation failed: ${schemaValidation.errors.join(', ')}`)
  }

  // Check unique constraints
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const existingRows = await db
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, data.tableId))

    const uniqueValidation = validateUniqueConstraints(
      data.data,
      table.schema,
      existingRows.map((r) => ({ id: r.id, data: r.data as RowData })),
      data.rowId // Exclude current row
    )
    if (!uniqueValidation.valid) {
      throw new Error(uniqueValidation.errors.join(', '))
    }
  }

  const now = new Date()

  await db
    .update(userTableRows)
    .set({ data: data.data, updatedAt: now })
    .where(eq(userTableRows.id, data.rowId))

  logger.info(`[${requestId}] Updated row ${data.rowId} in table ${data.tableId}`)

  return {
    id: data.rowId,
    data: data.data,
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
  const existingRow = await getRowById(tableId, rowId, workspaceId)
  if (!existingRow) {
    throw new Error('Row not found')
  }

  await db.delete(userTableRows).where(eq(userTableRows.id, rowId))

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
  const tableName = 'user_table_rows'

  // Build filter clause
  const filterClause = buildFilterClause(data.filter, tableName)
  if (!filterClause) {
    throw new Error('Filter is required for bulk update')
  }

  // Find matching rows
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

  // Validate merged data for each row
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

  // Update in batches
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
  const tableName = 'user_table_rows'

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

  // Delete in batches
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
  })

  logger.info(`[${requestId}] Deleted ${matchingRows.length} rows from table ${data.tableId}`)

  return {
    affectedCount: matchingRows.length,
    affectedRowIds: rowIds,
  }
}
