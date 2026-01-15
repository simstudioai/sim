import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { QueryFilter, TableSchema } from '@/lib/table'
import {
  getUniqueColumns,
  TABLE_LIMITS,
  validateRowAgainstSchema,
  validateRowSize,
  validateUniqueConstraints,
} from '@/lib/table'
import { buildFilterClause, buildSortClause } from '@/lib/table/query-builder'
import { checkTableAccess, checkTableWriteAccess, verifyTableWorkspace } from '../../utils'

const logger = createLogger('TableRowsAPI')

/**
 * Type for dynamic row data stored in tables.
 * Keys are column names, values can be any JSON-serializable type.
 */
type RowData = Record<string, unknown>

/**
 * Type for sort direction specification.
 */
type SortDirection = Record<string, 'asc' | 'desc'>

/**
 * Zod schema for inserting a single row into a table.
 *
 * The workspaceId is optional for backward compatibility but is validated
 * via table access checks when provided.
 */
const InsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

/**
 * Zod schema for batch inserting multiple rows.
 *
 * @remarks
 * Maximum 1000 rows per batch for performance and safety.
 */
const BatchInsertRowsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  rows: z
    .array(z.record(z.unknown()), { required_error: 'Rows array is required' })
    .min(1, 'At least one row is required')
    .max(1000, 'Cannot insert more than 1000 rows per batch'),
})

/** Inferred type for batch insert request body */
type BatchInsertBody = z.infer<typeof BatchInsertRowsSchema>

/**
 * Zod schema for querying rows with filtering, sorting, and pagination.
 */
const QueryRowsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  filter: z.record(z.unknown()).optional(),
  sort: z.record(z.enum(['asc', 'desc'])).optional(),
  limit: z.coerce
    .number({ required_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(TABLE_LIMITS.MAX_QUERY_LIMIT, `Limit cannot exceed ${TABLE_LIMITS.MAX_QUERY_LIMIT}`)
    .optional()
    .default(100),
  offset: z.coerce
    .number({ required_error: 'Offset must be a number' })
    .int('Offset must be an integer')
    .min(0, 'Offset must be 0 or greater')
    .optional()
    .default(0),
})

/**
 * Zod schema for updating multiple rows by filter criteria.
 *
 * @remarks
 * Maximum 1000 rows can be updated per operation for safety.
 */
const UpdateRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  filter: z.record(z.unknown(), { required_error: 'Filter criteria is required' }),
  data: z.record(z.unknown(), { required_error: 'Update data is required' }),
  limit: z.coerce
    .number({ required_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Cannot update more than 1000 rows per operation')
    .optional(),
})

/**
 * Zod schema for deleting multiple rows by filter criteria.
 *
 * @remarks
 * Maximum 1000 rows can be deleted per operation for safety.
 */
const DeleteRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  filter: z.record(z.unknown(), { required_error: 'Filter criteria is required' }),
  limit: z.coerce
    .number({ required_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Cannot delete more than 1000 rows per operation')
    .optional(),
})

/**
 * Route params for table row endpoints.
 */
interface TableRowsRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * Structure for row validation errors.
 */
interface RowValidationError {
  /** Index of the row with errors */
  row: number
  /** List of validation error messages */
  errors: string[]
}

/**
 * Handles batch insertion of multiple rows into a table.
 *
 * @param requestId - Request tracking ID for logging
 * @param tableId - ID of the target table
 * @param body - Validated batch insert request body
 * @param userId - ID of the authenticated user
 * @returns NextResponse with inserted rows or error
 *
 * @internal
 */
async function handleBatchInsert(
  requestId: string,
  tableId: string,
  body: BatchInsertBody,
  userId: string
): Promise<NextResponse> {
  const validated = BatchInsertRowsSchema.parse(body)

  // Check table write access (centralized access control)
  const accessCheck = await checkTableWriteAccess(tableId, userId)

  if (!accessCheck.hasAccess) {
    if ('notFound' in accessCheck && accessCheck.notFound) {
      logger.warn(`[${requestId}] Table not found: ${tableId}`)
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }
    logger.warn(
      `[${requestId}] User ${userId} attempted to insert rows into unauthorized table ${tableId}`
    )
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Security check: If workspaceId is provided, verify it matches the table's workspace
  if (validated.workspaceId) {
    const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
    if (!isValidWorkspace) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
  }

  // Get table definition
  const [table] = await db
    .select()
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
    .limit(1)

  if (!table) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  // Use the workspaceId from the access check (more secure)
  const workspaceId = validated.workspaceId || accessCheck.table.workspaceId

  // Check row count limit
  const remainingCapacity = table.maxRows - table.rowCount
  if (remainingCapacity < validated.rows.length) {
    return NextResponse.json(
      {
        error: `Insufficient capacity. Can only insert ${remainingCapacity} more rows (table has ${table.rowCount}/${table.maxRows} rows)`,
      },
      { status: 400 }
    )
  }

  // Validate all rows
  const errors: RowValidationError[] = []

  for (let i = 0; i < validated.rows.length; i++) {
    const rowData = validated.rows[i] as RowData

    // Validate row size
    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      errors.push({ row: i, errors: sizeValidation.errors })
      continue
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(rowData, table.schema as TableSchema)
    if (!rowValidation.valid) {
      errors.push({ row: i, errors: rowValidation.errors })
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: 'Validation failed for some rows',
        details: errors,
      },
      { status: 400 }
    )
  }

  // Check unique constraints if any unique columns exist
  const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
  if (uniqueColumns.length > 0) {
    // Fetch existing rows to check for uniqueness
    const existingRows = await db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
      })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, tableId))

    // Validate each row for unique constraints
    for (let i = 0; i < validated.rows.length; i++) {
      const rowData = validated.rows[i] as RowData

      // Also check against other rows in the batch
      const batchRows = validated.rows.slice(0, i).map((data, idx) => ({
        id: `batch_${idx}`,
        data: data as RowData,
      }))

      const uniqueValidation = validateUniqueConstraints(rowData, table.schema as TableSchema, [
        ...existingRows.map((r) => ({ id: r.id, data: r.data as RowData })),
        ...batchRows,
      ])

      if (!uniqueValidation.valid) {
        errors.push({ row: i, errors: uniqueValidation.errors })
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: 'Unique constraint violations in batch',
          details: errors,
        },
        { status: 400 }
      )
    }
  }

  // Insert all rows in a transaction to ensure atomicity
  const now = new Date()
  const rowsToInsert = validated.rows.map((data) => ({
    id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
    tableId,
    workspaceId,
    data,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  }))

  const insertedRows = await db.transaction(async (trx) => {
    // Insert all rows
    const inserted = await trx.insert(userTableRows).values(rowsToInsert).returning()

    // Update row count
    await trx
      .update(userTableDefinitions)
      .set({
        rowCount: sql`${userTableDefinitions.rowCount} + ${validated.rows.length}`,
        updatedAt: now,
      })
      .where(eq(userTableDefinitions.id, tableId))

    return inserted
  })

  logger.info(`[${requestId}] Batch inserted ${insertedRows.length} rows into table ${tableId}`)

  return NextResponse.json({
    success: true,
    data: {
      rows: insertedRows.map((r) => ({
        id: r.id,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      insertedCount: insertedRows.length,
      message: `Successfully inserted ${insertedRows.length} rows`,
    },
  })
}

/**
 * POST /api/table/[tableId]/rows
 *
 * Inserts a new row into the table.
 * Supports both single row and batch insert (when `rows` array is provided).
 *
 * @param request - The incoming HTTP request
 * @param context - Route context containing tableId param
 * @returns JSON response with inserted row(s) or error
 *
 * @example Single row insert:
 * ```json
 * {
 *   "workspaceId": "ws_123",
 *   "data": { "name": "John", "email": "john@example.com" }
 * }
 * ```
 *
 * @example Batch insert:
 * ```json
 * {
 *   "workspaceId": "ws_123",
 *   "rows": [
 *     { "name": "John", "email": "john@example.com" },
 *     { "name": "Jane", "email": "jane@example.com" }
 *   ]
 * }
 * ```
 */
export async function POST(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()

    // Check if this is a batch insert
    if (
      typeof body === 'object' &&
      body !== null &&
      'rows' in body &&
      Array.isArray((body as Record<string, unknown>).rows)
    ) {
      return handleBatchInsert(requestId, tableId, body as BatchInsertBody, authResult.userId)
    }

    // Single row insert
    const validated = InsertRowSchema.parse(body)

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to insert row into unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Get table definition
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Use the workspaceId from the access check (more secure)
    const workspaceId = validated.workspaceId || accessCheck.table.workspaceId
    const rowData = validated.data as RowData

    // Validate row size
    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(rowData, table.schema as TableSchema)
    if (!rowValidation.valid) {
      return NextResponse.json(
        { error: 'Row data does not match schema', details: rowValidation.errors },
        { status: 400 }
      )
    }

    // Check unique constraints if any unique columns exist
    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // Fetch existing rows to check for uniqueness
      const existingRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      const uniqueValidation = validateUniqueConstraints(
        rowData,
        table.schema as TableSchema,
        existingRows.map((r) => ({ id: r.id, data: r.data as RowData }))
      )

      if (!uniqueValidation.valid) {
        return NextResponse.json(
          { error: 'Unique constraint violation', details: uniqueValidation.errors },
          { status: 400 }
        )
      }
    }

    // Check row count limit
    if (table.rowCount >= table.maxRows) {
      return NextResponse.json(
        { error: `Table row limit reached (${table.maxRows} rows max)` },
        { status: 400 }
      )
    }

    // Insert row in a transaction to ensure atomicity
    const rowId = `row_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()

    const [row] = await db.transaction(async (trx) => {
      // Insert row
      const insertedRow = await trx
        .insert(userTableRows)
        .values({
          id: rowId,
          tableId,
          workspaceId,
          data: validated.data,
          createdAt: now,
          updatedAt: now,
          createdBy: authResult.userId,
        })
        .returning()

      // Update row count
      await trx
        .update(userTableDefinitions)
        .set({
          rowCount: sql`${userTableDefinitions.rowCount} + 1`,
          updatedAt: now,
        })
        .where(eq(userTableDefinitions.id, tableId))

      return insertedRow
    })

    logger.info(`[${requestId}] Inserted row ${rowId} into table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: row.id,
          data: row.data,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
        message: 'Row inserted successfully',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error inserting row:`, error)
    return NextResponse.json({ error: 'Failed to insert row' }, { status: 500 })
  }
}

/**
 * GET /api/table/[tableId]/rows?workspaceId=xxx&filter=...&sort=...&limit=100&offset=0
 *
 * Queries rows from the table with filtering, sorting, and pagination.
 *
 * @param request - The incoming HTTP request with query params
 * @param context - Route context containing tableId param
 * @returns JSON response with matching rows and pagination info
 *
 * @example Query with filter:
 * ```
 * GET /api/table/tbl_123/rows?filter={"status":{"eq":"active"}}&limit=50&offset=0
 * ```
 */
export async function GET(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const filterParam = searchParams.get('filter')
    const sortParam = searchParams.get('sort')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    let filter: Record<string, unknown> | undefined
    let sort: SortDirection | undefined

    try {
      if (filterParam) {
        filter = JSON.parse(filterParam) as Record<string, unknown>
      }
      if (sortParam) {
        sort = JSON.parse(sortParam) as SortDirection
      }
    } catch {
      return NextResponse.json({ error: 'Invalid filter or sort JSON' }, { status: 400 })
    }

    const validated = QueryRowsSchema.parse({
      workspaceId,
      filter,
      sort,
      limit,
      offset,
    })

    // Check table access (centralized access control)
    const accessCheck = await checkTableAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to query rows from unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Use the workspaceId from the access check (more secure)
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, actualWorkspaceId),
    ]

    // Add filter conditions if provided
    if (validated.filter) {
      const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
      if (filterClause) {
        baseConditions.push(filterClause)
      }
    }

    // Build query with combined conditions
    let query = db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(and(...baseConditions))

    // Apply sorting
    if (validated.sort) {
      const sortClause = buildSortClause(validated.sort, 'user_table_rows')
      if (sortClause) {
        query = query.orderBy(sortClause) as typeof query
      }
    } else {
      query = query.orderBy(userTableRows.createdAt) as typeof query
    }

    // Get total count with same filters (without pagination)
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(userTableRows)
      .where(and(...baseConditions))

    const [{ count: totalCount }] = await countQuery

    // Apply pagination
    const rows = await query.limit(validated.limit).offset(validated.offset)

    logger.info(
      `[${requestId}] Queried ${rows.length} rows from table ${tableId} (total: ${totalCount})`
    )

    return NextResponse.json({
      success: true,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          data: r.data,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        rowCount: rows.length,
        totalCount: Number(totalCount),
        limit: validated.limit,
        offset: validated.offset,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error querying rows:`, error)
    return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
  }
}

/**
 * PUT /api/table/[tableId]/rows
 *
 * Updates multiple rows matching filter criteria.
 *
 * @param request - The incoming HTTP request with filter and update data
 * @param context - Route context containing tableId param
 * @returns JSON response with count of updated rows
 *
 * @example Update all rows where status is "pending":
 * ```json
 * {
 *   "filter": { "status": { "eq": "pending" } },
 *   "data": { "status": "processed" }
 * }
 * ```
 */
export async function PUT(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = UpdateRowsByFilterSchema.parse(body)

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to update rows in unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Get table definition
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Use the workspaceId from the access check (more secure)
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId
    const updateData = validated.data as RowData

    // Validate new data size
    const sizeValidation = validateRowSize(updateData)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, actualWorkspaceId),
    ]

    // Add filter conditions
    const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
    if (filterClause) {
      baseConditions.push(filterClause)
    }

    // First, get the rows that match the filter to validate against schema
    let matchingRowsQuery = db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
      })
      .from(userTableRows)
      .where(and(...baseConditions))

    if (validated.limit) {
      matchingRowsQuery = matchingRowsQuery.limit(validated.limit) as typeof matchingRowsQuery
    }

    const matchingRows = await matchingRowsQuery

    if (matchingRows.length === 0) {
      return NextResponse.json(
        {
          success: true,
          data: {
            message: 'No rows matched the filter criteria',
            updatedCount: 0,
          },
        },
        { status: 200 }
      )
    }

    // Log warning for large operations but allow them
    if (matchingRows.length > 1000) {
      logger.warn(`[${requestId}] Updating ${matchingRows.length} rows. This may take some time.`)
    }

    // Validate that merged data matches schema for each row
    for (const row of matchingRows) {
      const existingData = row.data as RowData
      const mergedData = { ...existingData, ...updateData }
      const rowValidation = validateRowAgainstSchema(mergedData, table.schema as TableSchema)
      if (!rowValidation.valid) {
        return NextResponse.json(
          {
            error: 'Updated data does not match schema',
            details: rowValidation.errors,
            affectedRowId: row.id,
          },
          { status: 400 }
        )
      }
    }

    // Check unique constraints if any unique columns exist
    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // Fetch all rows (not just matching ones) to check for uniqueness
      const allRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      // Validate each updated row for unique constraints
      for (const row of matchingRows) {
        const existingData = row.data as RowData
        const mergedData = { ...existingData, ...updateData }
        const uniqueValidation = validateUniqueConstraints(
          mergedData,
          table.schema as TableSchema,
          allRows.map((r) => ({ id: r.id, data: r.data as RowData })),
          row.id // Exclude the current row being updated
        )

        if (!uniqueValidation.valid) {
          return NextResponse.json(
            {
              error: 'Unique constraint violation',
              details: uniqueValidation.errors,
              affectedRowId: row.id,
            },
            { status: 400 }
          )
        }
      }
    }

    // Update rows by merging existing data with new data in a transaction
    const now = new Date()
    const BATCH_SIZE = 100 // Smaller batch for updates since each is a separate query

    await db.transaction(async (trx) => {
      let totalUpdated = 0

      // Process updates in batches
      for (let i = 0; i < matchingRows.length; i += BATCH_SIZE) {
        const batch = matchingRows.slice(i, i + BATCH_SIZE)
        const updatePromises = batch.map((row) => {
          const existingData = row.data as RowData
          return trx
            .update(userTableRows)
            .set({
              data: { ...existingData, ...updateData },
              updatedAt: now,
            })
            .where(eq(userTableRows.id, row.id))
        })
        await Promise.all(updatePromises)
        totalUpdated += batch.length
        logger.info(
          `[${requestId}] Updated batch ${Math.floor(i / BATCH_SIZE) + 1} (${totalUpdated}/${matchingRows.length} rows)`
        )
      }
    })

    logger.info(`[${requestId}] Updated ${matchingRows.length} rows in table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Rows updated successfully',
        updatedCount: matchingRows.length,
        updatedRowIds: matchingRows.map((r) => r.id),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating rows by filter:`, error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const detailedError = `Failed to update rows: ${errorMessage}`

    return NextResponse.json({ error: detailedError }, { status: 500 })
  }
}

/**
 * DELETE /api/table/[tableId]/rows
 *
 * Deletes multiple rows matching filter criteria.
 *
 * @param request - The incoming HTTP request with filter criteria
 * @param context - Route context containing tableId param
 * @returns JSON response with count of deleted rows
 *
 * @example Delete all rows where seen is false:
 * ```json
 * {
 *   "filter": { "seen": { "eq": false } }
 * }
 * ```
 */
export async function DELETE(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = DeleteRowsByFilterSchema.parse(body)

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to delete rows from unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Use the workspaceId from the access check (more secure)
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, actualWorkspaceId),
    ]

    // Add filter conditions
    const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
    if (filterClause) {
      baseConditions.push(filterClause)
    }

    // Get matching rows first (for reporting and limit enforcement)
    let matchingRowsQuery = db
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(and(...baseConditions))

    if (validated.limit) {
      matchingRowsQuery = matchingRowsQuery.limit(validated.limit) as typeof matchingRowsQuery
    }

    const matchingRows = await matchingRowsQuery

    if (matchingRows.length === 0) {
      return NextResponse.json(
        {
          success: true,
          data: {
            message: 'No rows matched the filter criteria',
            deletedCount: 0,
          },
        },
        { status: 200 }
      )
    }

    // Log warning for large operations but allow them
    if (matchingRows.length > 1000) {
      logger.warn(`[${requestId}] Deleting ${matchingRows.length} rows. This may take some time.`)
    }

    // Delete the matching rows in a transaction to ensure atomicity
    const rowIds = matchingRows.map((r) => r.id)
    const BATCH_SIZE = 1000

    await db.transaction(async (trx) => {
      let totalDeleted = 0

      // Delete rows in batches to avoid stack overflow
      for (let i = 0; i < rowIds.length; i += BATCH_SIZE) {
        const batch = rowIds.slice(i, i + BATCH_SIZE)
        await trx.delete(userTableRows).where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, actualWorkspaceId),
            sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
              batch.map((id) => sql`${id}`),
              sql`, `
            )}])`
          )
        )
        totalDeleted += batch.length
        logger.info(
          `[${requestId}] Deleted batch ${Math.floor(i / BATCH_SIZE) + 1} (${totalDeleted}/${rowIds.length} rows)`
        )
      }

      // Update row count
      await trx
        .update(userTableDefinitions)
        .set({
          rowCount: sql`${userTableDefinitions.rowCount} - ${matchingRows.length}`,
          updatedAt: new Date(),
        })
        .where(eq(userTableDefinitions.id, tableId))
    })

    logger.info(`[${requestId}] Deleted ${matchingRows.length} rows from table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Rows deleted successfully',
        deletedCount: matchingRows.length,
        deletedRowIds: rowIds,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting rows by filter:`, error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const detailedError = `Failed to delete rows: ${errorMessage}`

    return NextResponse.json({ error: detailedError }, { status: 500 })
  }
}
