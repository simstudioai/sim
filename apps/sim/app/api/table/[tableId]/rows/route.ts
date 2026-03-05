import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { Filter, RowData, Sort, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  checkUniqueConstraintsDb,
  getUniqueColumns,
  insertRow,
  TABLE_LIMITS,
  USER_TABLE_ROWS_SQL_NAME,
  validateBatchRows,
  validateRowAgainstSchema,
  validateRowData,
  validateRowSize,
} from '@/lib/table'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import { accessError, checkAccess } from '../../utils'

const logger = createLogger('TableRowsAPI')

const InsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

const BatchInsertRowsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  rows: z
    .array(z.record(z.unknown()), { required_error: 'Rows array is required' })
    .min(1, 'At least one row is required')
    .max(1000, 'Cannot insert more than 1000 rows per batch'),
})

const QueryRowsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
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

const UpdateRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: z.record(z.unknown(), { required_error: 'Filter criteria is required' }),
  data: z.record(z.unknown(), { required_error: 'Update data is required' }),
  limit: z.coerce
    .number({ required_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Cannot update more than 1000 rows per operation')
    .optional(),
})

const DeleteRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: z.record(z.unknown(), { required_error: 'Filter criteria is required' }),
  limit: z.coerce
    .number({ required_error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Cannot delete more than 1000 rows per operation')
    .optional(),
})

const DeleteRowsByIdsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  rowIds: z
    .array(z.string().min(1), { required_error: 'Row IDs are required' })
    .min(1, 'At least one row ID is required')
    .max(1000, 'Cannot delete more than 1000 rows per operation'),
})

const DeleteRowsRequestSchema = z.union([DeleteRowsByFilterSchema, DeleteRowsByIdsSchema])

interface TableRowsRouteParams {
  params: Promise<{ tableId: string }>
}

async function handleBatchInsert(
  requestId: string,
  tableId: string,
  body: z.infer<typeof BatchInsertRowsSchema>,
  userId: string
): Promise<NextResponse> {
  const validated = BatchInsertRowsSchema.parse(body)

  const accessResult = await checkAccess(tableId, userId, 'write')
  if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

  const { table } = accessResult

  if (validated.workspaceId !== table.workspaceId) {
    logger.warn(
      `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
    )
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

  // Validate rows before calling service (service also validates, but route-level
  // validation returns structured HTTP responses)
  const validation = await validateBatchRows({
    rows: validated.rows as RowData[],
    schema: table.schema as TableSchema,
    tableId,
  })
  if (!validation.valid) return validation.response

  try {
    const insertedRows = await batchInsertRows(
      {
        tableId,
        rows: validated.rows as RowData[],
        workspaceId: validated.workspaceId,
        userId,
      },
      table,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        rows: insertedRows.map((r) => ({
          id: r.id,
          data: r.data,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        })),
        insertedCount: insertedRows.length,
        message: `Successfully inserted ${insertedRows.length} rows`,
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (
      errorMessage.includes('row limit') ||
      errorMessage.includes('Insufficient capacity') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('must be unique') ||
      errorMessage.includes('Row size exceeds') ||
      errorMessage.match(/^Row \d+:/)
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error batch inserting rows:`, error)
    return NextResponse.json({ error: 'Failed to insert rows' }, { status: 500 })
  }
}

/** POST /api/table/[tableId]/rows - Inserts row(s). Supports single or batch insert. */
export async function POST(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()

    if (
      typeof body === 'object' &&
      body !== null &&
      'rows' in body &&
      Array.isArray((body as Record<string, unknown>).rows)
    ) {
      return handleBatchInsert(
        requestId,
        tableId,
        body as z.infer<typeof BatchInsertRowsSchema>,
        authResult.userId
      )
    }

    const validated = InsertRowSchema.parse(body)

    const accessResult = await checkAccess(tableId, authResult.userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const rowData = validated.data as RowData

    // Validate at route level for structured HTTP error responses
    const validation = await validateRowData({
      rowData,
      schema: table.schema as TableSchema,
      tableId,
    })
    if (!validation.valid) return validation.response

    // Service handles atomic capacity check + insert in a transaction
    const row = await insertRow(
      {
        tableId,
        data: rowData,
        workspaceId: validated.workspaceId,
        userId: authResult.userId,
      },
      table,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: row.id,
          data: row.data,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
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

    const errorMessage = error instanceof Error ? error.message : String(error)

    if (
      errorMessage.includes('row limit') ||
      errorMessage.includes('Insufficient capacity') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('must be unique') ||
      errorMessage.includes('Row size exceeds')
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error inserting row:`, error)
    return NextResponse.json({ error: 'Failed to insert row' }, { status: 500 })
  }
}

/** GET /api/table/[tableId]/rows - Queries rows with filtering, sorting, and pagination. */
export async function GET(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
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
    let sort: Sort | undefined

    try {
      if (filterParam) {
        filter = JSON.parse(filterParam) as Record<string, unknown>
      }
      if (sortParam) {
        sort = JSON.parse(sortParam) as Sort
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

    const accessResult = await checkAccess(tableId, authResult.userId, 'read')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    if (validated.filter) {
      const filterClause = buildFilterClause(validated.filter as Filter, USER_TABLE_ROWS_SQL_NAME)
      if (filterClause) {
        baseConditions.push(filterClause)
      }
    }

    let query = db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(and(...baseConditions))

    if (validated.sort) {
      const schema = table.schema as TableSchema
      const sortClause = buildSortClause(validated.sort, USER_TABLE_ROWS_SQL_NAME, schema.columns)
      if (sortClause) {
        query = query.orderBy(sortClause) as typeof query
      }
    } else {
      query = query.orderBy(userTableRows.createdAt) as typeof query
    }

    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(userTableRows)
      .where(and(...baseConditions))

    const [{ count: totalCount }] = await countQuery

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

/** PUT /api/table/[tableId]/rows - Updates rows matching filter criteria. */
export async function PUT(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = UpdateRowsByFilterSchema.parse(body)

    const accessResult = await checkAccess(tableId, authResult.userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updateData = validated.data as RowData

    const sizeValidation = validateRowSize(updateData)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    const filterClause = buildFilterClause(validated.filter as Filter, USER_TABLE_ROWS_SQL_NAME)
    if (filterClause) {
      baseConditions.push(filterClause)
    }

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

    if (matchingRows.length > TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
      logger.warn(`[${requestId}] Updating ${matchingRows.length} rows. This may take some time.`)
    }

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

    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // If updating multiple rows, check that updateData doesn't set any unique column
      // (would cause all rows to have the same value, violating uniqueness)
      if (matchingRows.length > 1) {
        const uniqueColumnsInUpdate = uniqueColumns.filter((col) => col.name in updateData)
        if (uniqueColumnsInUpdate.length > 0) {
          return NextResponse.json(
            {
              error: 'Cannot set unique column values when updating multiple rows',
              details: [
                `Columns with unique constraint: ${uniqueColumnsInUpdate.map((c) => c.name).join(', ')}. ` +
                  `Updating ${matchingRows.length} rows with the same value would violate uniqueness.`,
              ],
            },
            { status: 400 }
          )
        }
      }

      // Check unique constraints against database for each row
      for (const row of matchingRows) {
        const existingData = row.data as RowData
        const mergedData = { ...existingData, ...updateData }
        const uniqueValidation = await checkUniqueConstraintsDb(
          tableId,
          mergedData,
          table.schema as TableSchema,
          row.id
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

    const now = new Date()

    await db.transaction(async (trx) => {
      let totalUpdated = 0

      for (let i = 0; i < matchingRows.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
        const batch = matchingRows.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
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
          `[${requestId}] Updated batch ${Math.floor(i / TABLE_LIMITS.UPDATE_BATCH_SIZE) + 1} (${totalUpdated}/${matchingRows.length} rows)`
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

/** DELETE /api/table/[tableId]/rows - Deletes rows matching filter criteria. */
export async function DELETE(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = DeleteRowsRequestSchema.parse(body)

    const accessResult = await checkAccess(tableId, authResult.userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    let rowIds: string[] = []
    let missingRowIds: string[] | undefined
    let requestedCount: number | undefined

    if ('rowIds' in validated) {
      const uniqueRequestedRowIds = Array.from(new Set(validated.rowIds))
      requestedCount = uniqueRequestedRowIds.length

      const matchingRows = await db
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(
          and(
            ...baseConditions,
            sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
              uniqueRequestedRowIds.map((id) => sql`${id}`),
              sql`, `
            )}])`
          )
        )

      const matchedRowIds = matchingRows.map((r) => r.id)
      const matchedIdSet = new Set(matchedRowIds)
      missingRowIds = uniqueRequestedRowIds.filter((id) => !matchedIdSet.has(id))
      rowIds = matchedRowIds
    } else {
      const filterClause = buildFilterClause(validated.filter as Filter, USER_TABLE_ROWS_SQL_NAME)
      if (filterClause) {
        baseConditions.push(filterClause)
      }

      let matchingRowsQuery = db
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(and(...baseConditions))

      if (validated.limit) {
        matchingRowsQuery = matchingRowsQuery.limit(validated.limit) as typeof matchingRowsQuery
      }

      const matchingRows = await matchingRowsQuery
      rowIds = matchingRows.map((r) => r.id)
    }

    if (rowIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          data: {
            message:
              'rowIds' in validated
                ? 'No matching rows found for the provided IDs'
                : 'No rows matched the filter criteria',
            deletedCount: 0,
            deletedRowIds: [],
            ...(requestedCount !== undefined ? { requestedCount } : {}),
            ...(missingRowIds ? { missingRowIds } : {}),
          },
        },
        { status: 200 }
      )
    }

    if (rowIds.length > TABLE_LIMITS.DELETE_BATCH_SIZE) {
      logger.warn(`[${requestId}] Deleting ${rowIds.length} rows. This may take some time.`)
    }

    await db.transaction(async (trx) => {
      let totalDeleted = 0

      for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
        const batch = rowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
        await trx.delete(userTableRows).where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, validated.workspaceId),
            sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
              batch.map((id) => sql`${id}`),
              sql`, `
            )}])`
          )
        )
        totalDeleted += batch.length
        logger.info(
          `[${requestId}] Deleted batch ${Math.floor(i / TABLE_LIMITS.DELETE_BATCH_SIZE) + 1} (${totalDeleted}/${rowIds.length} rows)`
        )
      }
    })

    logger.info(`[${requestId}] Deleted ${rowIds.length} rows from table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Rows deleted successfully',
        deletedCount: rowIds.length,
        deletedRowIds: rowIds,
        ...(requestedCount !== undefined ? { requestedCount } : {}),
        ...(missingRowIds ? { missingRowIds } : {}),
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
