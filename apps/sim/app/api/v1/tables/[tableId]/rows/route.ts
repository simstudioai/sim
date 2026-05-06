import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V1BatchInsertTableRowsBody,
  v1CreateTableRowContract,
  v1DeleteTableRowsContract,
  v1ListTableRowsContract,
  v1UpdateRowsByFilterContract,
} from '@/lib/api/contracts/v1/tables'
import {
  parseRequest,
  validationErrorResponse,
  validationErrorResponseFromError,
} from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Filter, RowData, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  deleteRowsByFilter,
  deleteRowsByIds,
  insertRow,
  USER_TABLE_ROWS_SQL_NAME,
  updateRowsByFilter,
  validateBatchRows,
  validateRowData,
  validateRowSize,
} from '@/lib/table'
import { buildFilterClause, buildSortClause, TableQueryValidationError } from '@/lib/table/sql'
import { accessError, checkAccess } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableRowsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRowsRouteParams {
  params: Promise<{ tableId: string }>
}

async function handleBatchInsert(
  requestId: string,
  tableId: string,
  validated: V1BatchInsertTableRowsBody,
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
export const GET = withRouteHandler(async (request: NextRequest, context: TableRowsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1ListTableRowsContract, request, context, {
      validationErrorResponse: (error) => {
        const hasJsonError = error.issues.some(
          (issue) =>
            issue.message === 'Invalid filter JSON' || issue.message === 'Invalid sort JSON'
        )
        if (hasJsonError) {
          return NextResponse.json({ error: 'Invalid filter or sort JSON' }, { status: 400 })
        }
        return validationErrorResponse(error)
      },
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.query
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

    const rowsPromise = query.limit(validated.limit).offset(validated.offset)

    let totalCount: number | null = null
    if (validated.includeTotal) {
      const countQuery = db
        .select({ count: sql<number>`count(*)` })
        .from(userTableRows)
        .where(and(...baseConditions))
      const [countResult, rows] = await Promise.all([countQuery, rowsPromise])
      totalCount = Number(countResult[0].count)
      return NextResponse.json({
        success: true,
        data: {
          rows: rows.map((r) => ({
            id: r.id,
            data: r.data,
            position: r.position,
            createdAt:
              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            updatedAt:
              r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
          })),
          rowCount: rows.length,
          totalCount,
          limit: validated.limit,
          offset: validated.offset,
        },
      })
    }

    const rows = await rowsPromise

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
        totalCount,
        limit: validated.limit,
        offset: validated.offset,
      },
    })
  } catch (error) {
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof TableQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    logger.error(`[${requestId}] Error querying rows:`, error)
    return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
  }
})

/** POST /api/v1/tables/[tableId]/rows — Insert row(s). Supports single or batch. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: TableRowsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-rows')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1CreateTableRowContract, request, context)
      if (!parsed.success) return parsed.response

      const { tableId } = parsed.data.params
      if ('rows' in parsed.data.body) {
        const batchValidated = parsed.data.body
        const scopeError = checkWorkspaceScope(rateLimit, batchValidated.workspaceId)
        if (scopeError) return scopeError
        return handleBatchInsert(requestId, tableId, batchValidated, userId)
      }

      const validated = parsed.data.body

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
      const validationResponse = validationErrorResponseFromError(error)
      if (validationResponse) return validationResponse

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
)

/** PUT /api/v1/tables/[tableId]/rows — Bulk update rows by filter. */
export const PUT = withRouteHandler(async (request: NextRequest, context: TableRowsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1UpdateRowsByFilterContract, request, context)
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

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
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof TableQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
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
})

/** DELETE /api/v1/tables/[tableId]/rows — Delete rows by filter or IDs. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: TableRowsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-rows')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1DeleteTableRowsContract, request, context)
      if (!parsed.success) return parsed.response
      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return scopeError

      const accessResult = await checkAccess(tableId, userId, 'write')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

      const { table } = accessResult

      if (validated.workspaceId !== table.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      if (validated.rowIds) {
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
      const validationResponse = validationErrorResponseFromError(error)
      if (validationResponse) return validationResponse

      if (error instanceof TableQueryValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      const errorMessage = toError(error).message

      if (errorMessage.includes('Filter is required')) {
        return NextResponse.json({ error: errorMessage }, { status: 400 })
      }

      logger.error(`[${requestId}] Error deleting rows:`, error)
      return NextResponse.json({ error: 'Failed to delete rows' }, { status: 500 })
    }
  }
)
