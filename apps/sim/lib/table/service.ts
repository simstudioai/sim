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
import { and, count, eq, sql } from 'drizzle-orm'
import { TABLE_LIMITS, USER_TABLE_ROWS_SQL_NAME } from './constants'
import { buildFilterClause, buildSortClause } from './sql'
import type {
  BatchInsertData,
  BulkDeleteByIdsData,
  BulkDeleteByIdsResult,
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
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: table.schema as TableSchema,
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    workspaceId: table.workspaceId,
    createdBy: table.createdBy,
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
    .where(eq(userTableDefinitions.workspaceId, workspaceId))
  return result.count
}

export async function listTables(workspaceId: string): Promise<TableDefinition[]> {
  const tables = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, workspaceId))
    .orderBy(userTableDefinitions.createdAt)

  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    schema: t.schema as TableSchema,
    rowCount: t.rowCount,
    maxRows: t.maxRows,
    workspaceId: t.workspaceId,
    createdBy: t.createdBy,
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

  const tableId = `tbl_${crypto.randomUUID().replace(/-/g, '')}`
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
    createdAt: now,
    updatedAt: now,
  }

  // Wrap count check, duplicate check, and insert in a transaction with FOR UPDATE
  // to prevent TOCTOU race on the table count limit
  await db.transaction(async (trx) => {
    await trx.execute(sql`SELECT 1 FROM workspaces WHERE id = ${data.workspaceId} FOR UPDATE`)

    const [{ count: existingCount }] = await trx
      .select({ count: count() })
      .from(userTableDefinitions)
      .where(eq(userTableDefinitions.workspaceId, data.workspaceId))

    if (Number(existingCount) >= maxTables) {
      throw new Error(`Workspace has reached maximum table limit (${maxTables})`)
    }

    const duplicateName = await trx
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

    await trx.insert(userTableDefinitions).values(newTable)
  })

  logger.info(`[${requestId}] Created table ${tableId} in workspace ${data.workspaceId}`)

  return {
    id: newTable.id,
    name: newTable.name,
    description: newTable.description,
    schema: newTable.schema as TableSchema,
    rowCount: 0,
    maxRows: newTable.maxRows,
    workspaceId: newTable.workspaceId,
    createdBy: newTable.createdBy,
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

  const rowId = `row_${crypto.randomUUID().replace(/-/g, '')}`
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

    return trx
      .insert(userTableRows)
      .values({
        id: rowId,
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        data: data.data,
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
  const rowsToInsert = data.rows.map((rowData) => ({
    id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
    tableId: data.tableId,
    workspaceId: data.workspaceId,
    data: rowData,
    createdAt: now,
    updatedAt: now,
    ...(data.userId ? { createdBy: data.userId } : {}),
  }))

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

    return trx.insert(userTableRows).values(rowsToInsert).returning()
  })

  logger.info(`[${requestId}] Batch inserted ${data.rows.length} rows into table ${data.tableId}`)

  return insertedRows.map((r) => ({
    id: r.id,
    data: r.data as RowData,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
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

    const [insertedRow] = await trx
      .insert(userTableRows)
      .values({
        id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
        tableId: data.tableId,
        workspaceId: data.workspaceId,
        data: data.data,
        createdAt: now,
        updatedAt: now,
        ...(data.userId ? { createdBy: data.userId } : {}),
      })
      .returning()

    return {
      row: {
        id: insertedRow.id,
        data: insertedRow.data as RowData,
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

  // Check unique constraints using optimized database query
  const uniqueColumns = getUniqueColumns(table.schema)
  if (uniqueColumns.length > 0) {
    const uniqueValidation = await checkUniqueConstraintsDb(
      data.tableId,
      data.data,
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
