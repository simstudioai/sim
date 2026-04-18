import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { toError } from '@/lib/core/utils/helpers'
import { generateRequestId } from '@/lib/core/utils/request'
import type { Filter, RowData, Sort, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  deleteRowsByFilter,
  deleteRowsByIds,
  insertRow,
  TABLE_LIMITS,
  USER_TABLE_ROWS_SQL_NAME,
  updateRowsByFilter,
  validateBatchRows,
  validateRowData,
  validateRowSize,
} from '@/lib/table'
import { buildFilterClause, buildSortClause } from '@/lib/table/sql'
import { accessError, checkAccess } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableRowsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
  limit: z
    .preprocess(
      (val) => (val === null || val === undefined || val === '' ? undefined : Number(val)),
      z
        .number({ required_error: 'Limit must be a number' })
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(TABLE_LIMITS.MAX_QUERY_LIMIT, `Limit cannot exceed ${TABLE_LIMITS.MAX_QUERY_LIMIT}`)
        .optional()
    )
    .default(100),
  offset: z
    .preprocess(
      (val) => (val === null || val === undefined || val === '' ? undefined : Number(val)),
      z
        .number({ required_error: 'Offset must be a number' })
        .int('Offset must be an integer')
        .min(0, 'Offset must be 0 or greater')
        .optional()
    )
    .default(0),
})

const nonEmptyFilter = z
  .record(z.unknown(), { required_error: 'Filter criteria is required' })
  .refine((f) => Object.keys(f).length > 0, { message: 'Filter must not be empty' })

const optionalPositiveLimit = (max: number, label: string) =>
  z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : Number(val)),
    z
      .number()
      .int(`${label} must be an integer`)
      .min(1, `${label} must be at least 1`)
      .max(max, `Cannot ${label.toLowerCase()} more than ${max} rows per operation`)
      .optional()
  )

const UpdateRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: nonEmptyFilter,
  data: z.record(z.unknown(), { required_error: 'Update data is required' }),
  limit: optionalPositiveLimit(1000, 'Limit'),
})

const DeleteRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: nonEmptyFilter,
  limit: optionalPositiveLimit(1000, 'Limit'),
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
  validated: z.infer<typeof BatchInsertRowsSchema>,
  userId: string
): Promise<NextResponse> {
  const accessResult = await checkAccess(tableId, userId, 'write')
  if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

  const { table } = accessResult

  if (validated.workspaceId !== table.workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

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
          position: r.position,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        })),
        insertedCount: insertedRows.length,
        message: `Successfully inserted ${insertedRows.length} rows`,
      },
    })
  } catch (error) {
    const errorMessage = toError(error).message

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

/** GET /api/v1/tables/[tableId]/rows — Query rows with filtering, sorting, pagination. */
export async function GET(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params
    const { searchParams } = new URL(request.url)

    let filter: Record<string, unknown> | undefined
    let sort: Sort | undefined

    try {
      const filterParam = searchParams.get('filter')
      const sortParam = searchParams.get('sort')
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
      workspaceId: searchParams.get('workspaceId'),
      filter,
      sort,
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    })

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const accessResult = await checkAccess(tableId, userId, 'read')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
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
        position: userTableRows.position,
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
      } else {
        query = query.orderBy(userTableRows.position) as typeof query
      }
    } else {
      query = query.orderBy(userTableRows.position) as typeof query
    }

    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(userTableRows)
      .where(and(...baseConditions))

    const [countResult, rows] = await Promise.all([
      countQuery,
      query.limit(validated.limit).offset(validated.offset),
    ])
    const totalCount = countResult[0].count

    return NextResponse.json({
      success: true,
      data: {
        rows: rows.map((r) => ({
          id: r.id,
          data: r.data,
          position: r.position,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
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

/** POST /api/v1/tables/[tableId]/rows — Insert row(s). Supports single or batch. */
export async function POST(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    if (
      typeof body === 'object' &&
      body !== null &&
      'rows' in body &&
      Array.isArray((body as Record<string, unknown>).rows)
    ) {
      const batchValidated = BatchInsertRowsSchema.parse(body)
      const scopeError = checkWorkspaceScope(rateLimit, batchValidated.workspaceId)
      if (scopeError) return scopeError
      return handleBatchInsert(requestId, tableId, batchValidated, userId)
    }

    const validated = InsertRowSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const accessResult = await checkAccess(tableId, userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const rowData = validated.data as RowData

    const validation = await validateRowData({
      rowData,
      schema: table.schema as TableSchema,
      tableId,
    })
    if (!validation.valid) return validation.response

    const row = await insertRow(
      {
        tableId,
        data: rowData,
        workspaceId: validated.workspaceId,
        userId,
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
          position: row.position,
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

    const errorMessage = toError(error).message

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

/** PUT /api/v1/tables/[tableId]/rows — Bulk update rows by filter. */
export async function PUT(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = UpdateRowsByFilterSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const accessResult = await checkAccess(tableId, userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const sizeValidation = validateRowSize(validated.data as RowData)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Validation error', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    const result = await updateRowsByFilter(
      {
        tableId,
        filter: validated.filter as Filter,
        data: validated.data as RowData,
        limit: validated.limit,
        workspaceId: validated.workspaceId,
      },
      table,
      requestId
    )

    if (result.affectedCount === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: 'No rows matched the filter criteria',
          updatedCount: 0,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Rows updated successfully',
        updatedCount: result.affectedCount,
        updatedRowIds: result.affectedRowIds,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = toError(error).message

    if (
      errorMessage.includes('Row size exceeds') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('must be unique') ||
      errorMessage.includes('Unique constraint violation') ||
      errorMessage.includes('Cannot set unique column') ||
      errorMessage.includes('Filter is required')
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error updating rows by filter:`, error)
    return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 })
  }
}

/** DELETE /api/v1/tables/[tableId]/rows — Delete rows by filter or IDs. */
export async function DELETE(request: NextRequest, { params }: TableRowsRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = DeleteRowsRequestSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const accessResult = await checkAccess(tableId, userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (validated.workspaceId !== table.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    if ('rowIds' in validated) {
      const result = await deleteRowsByIds(
        { tableId, rowIds: validated.rowIds, workspaceId: validated.workspaceId },
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          message:
            result.deletedCount === 0
              ? 'No matching rows found for the provided IDs'
              : 'Rows deleted successfully',
          deletedCount: result.deletedCount,
          deletedRowIds: result.deletedRowIds,
          requestedCount: result.requestedCount,
          ...(result.missingRowIds.length > 0 ? { missingRowIds: result.missingRowIds } : {}),
        },
      })
    }

    const result = await deleteRowsByFilter(
      {
        tableId,
        filter: validated.filter as Filter,
        limit: validated.limit,
        workspaceId: validated.workspaceId,
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        message:
          result.affectedCount === 0
            ? 'No rows matched the filter criteria'
            : 'Rows deleted successfully',
        deletedCount: result.affectedCount,
        deletedRowIds: result.affectedRowIds,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = toError(error).message

    if (errorMessage.includes('Filter is required')) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error deleting rows:`, error)
    return NextResponse.json({ error: 'Failed to delete rows' }, { status: 500 })
  }
}
