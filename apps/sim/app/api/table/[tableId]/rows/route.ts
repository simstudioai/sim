import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type BatchInsertTableRowsBodyInput,
  batchUpdateTableRowsBodySchema,
  deleteTableRowsBodySchema,
  insertTableRowsContract,
  tableRowsQuerySchema,
  updateRowsByFilterBodySchema,
} from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { isZodError, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Filter, RowData, Sort, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  batchUpdateRows,
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

const logger = createLogger('TableRowsAPI')

interface TableRowsRouteParams {
  params: Promise<{ tableId: string }>
}

async function handleBatchInsert(
  requestId: string,
  tableId: string,
  validated: BatchInsertTableRowsBodyInput,
  userId: string
): Promise<NextResponse> {
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
        positions: validated.positions,
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

/** POST /api/table/[tableId]/rows - Inserts row(s). Supports single or batch insert. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: TableRowsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(insertTableRowsContract, request, context)
      if (!parsed.success) return parsed.response

      const { tableId } = parsed.data.params
      const body = parsed.data.body

      if ('rows' in body) {
        return handleBatchInsert(requestId, tableId, body, authResult.userId)
      }

      const validated = body

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
          position: validated.position,
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
      if (isZodError(error)) {
        return validationErrorResponse(error)
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
)

/** GET /api/table/[tableId]/rows - Queries rows with filtering, sorting, and pagination. */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: TableRowsRouteParams) => {
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
      const includeTotalParam = searchParams.get('includeTotal')

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

      const validated = tableRowsQuerySchema.parse({
        workspaceId,
        filter,
        sort,
        limit,
        offset,
        includeTotal: includeTotalParam,
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
          executions: userTableRows.executions,
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

      let totalCount: number | null = null
      if (validated.includeTotal) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(userTableRows)
          .where(and(...baseConditions))
        totalCount = Number(count)
      }

      const rows = await query.limit(validated.limit).offset(validated.offset)

      logger.info(
        `[${requestId}] Queried ${rows.length} rows from table ${tableId} (total: ${totalCount ?? 'n/a'})`
      )

      return NextResponse.json({
        success: true,
        data: {
          rows: rows.map((r) => ({
            id: r.id,
            data: r.data,
            executions: r.executions ?? {},
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
    } catch (error) {
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

      if (error instanceof TableQueryValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      logger.error(`[${requestId}] Error querying rows:`, error)
      return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
    }
  }
)

/** PUT /api/table/[tableId]/rows - Updates rows matching filter criteria. */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: TableRowsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      }

      const validated = updateRowsByFilterBodySchema.parse(body)

      const accessResult = await checkAccess(tableId, authResult.userId, 'write')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

      const { table } = accessResult

      if (validated.workspaceId !== table.workspaceId) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const sizeValidation = validateRowSize(validated.data as RowData)
      if (!sizeValidation.valid) {
        return NextResponse.json(
          { error: 'Invalid row data', details: sizeValidation.errors },
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

      return NextResponse.json({
        success: true,
        data: {
          message: 'Rows updated successfully',
          updatedCount: result.affectedCount,
          updatedRowIds: result.affectedRowIds,
        },
      })
    } catch (error) {
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

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
  }
)

/** DELETE /api/table/[tableId]/rows - Deletes rows matching filter criteria or by IDs. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: TableRowsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      }

      const validated = deleteTableRowsBodySchema.parse(body)

      const accessResult = await checkAccess(tableId, authResult.userId, 'write')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

      const { table } = accessResult

      if (validated.workspaceId !== table.workspaceId) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
        )
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
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

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

/** PATCH /api/table/[tableId]/rows - Batch updates rows by ID. */
export const PATCH = withRouteHandler(
  async (request: NextRequest, { params }: TableRowsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      }

      const validated = batchUpdateTableRowsBodySchema.parse(body)

      const accessResult = await checkAccess(tableId, authResult.userId, 'write')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

      const { table } = accessResult

      if (validated.workspaceId !== table.workspaceId) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const result = await batchUpdateRows(
        {
          tableId,
          updates: validated.updates as Array<{ rowId: string; data: RowData }>,
          workspaceId: validated.workspaceId,
        },
        table,
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          message: 'Rows updated successfully',
          updatedCount: result.affectedCount,
          updatedRowIds: result.affectedRowIds,
        },
      })
    } catch (error) {
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

      const errorMessage = toError(error).message

      if (
        errorMessage.includes('Row size exceeds') ||
        errorMessage.includes('Schema validation') ||
        errorMessage.includes('must be valid') ||
        errorMessage.includes('must be string') ||
        errorMessage.includes('must be number') ||
        errorMessage.includes('must be boolean') ||
        errorMessage.includes('must be unique') ||
        errorMessage.includes('Unique constraint violation') ||
        errorMessage.includes('Cannot set unique column') ||
        errorMessage.includes('Rows not found')
      ) {
        return NextResponse.json({ error: errorMessage }, { status: 400 })
      }

      logger.error(`[${requestId}] Error batch updating rows:`, error)
      return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 })
    }
  }
)
