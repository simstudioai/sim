import { createLogger } from '@sim/logger'
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
import { type AuthTypeValue, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Filter, RowData, Sort, TableRowsCursor, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  batchUpdateRows,
  deleteRowsByFilter,
  deleteRowsByIds,
  insertRow,
  updateRowsByFilter,
  validateBatchRows,
  validateRowData,
  validateRowSize,
} from '@/lib/table'
import { queryRows } from '@/lib/table/rows/service'
import { TableQueryValidationError } from '@/lib/table/sql'
import { rowWireTranslators } from '@/app/api/table/row-wire'
import { accessError, checkAccess, rowWriteErrorResponse } from '@/app/api/table/utils'

const logger = createLogger('TableRowsAPI')

interface TableRowsRouteParams {
  params: Promise<{ tableId: string }>
}

async function handleBatchInsert(
  requestId: string,
  tableId: string,
  validated: BatchInsertTableRowsBodyInput,
  userId: string,
  authType: AuthTypeValue | undefined
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

  const wire = rowWireTranslators(authType, table.schema as TableSchema)
  const rows = (validated.rows as RowData[]).map((row) => wire.dataIn(row))

  // Validate rows before calling service (service also validates, but route-level
  // validation returns structured HTTP responses)
  const validation = await validateBatchRows({
    rows,
    schema: table.schema as TableSchema,
    tableId,
  })
  if (!validation.valid) return validation.response

  try {
    const insertedRows = await batchInsertRows(
      {
        tableId,
        rows,
        workspaceId: validated.workspaceId,
        userId,
        orderKeys: validated.orderKeys,
      },
      table,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        rows: insertedRows.map((r) => ({
          id: r.id,
          data: wire.dataOut(r.data),
          position: r.position,
          orderKey: r.orderKey ?? undefined,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        })),
        insertedCount: insertedRows.length,
        message: `Successfully inserted ${insertedRows.length} rows`,
      },
    })
  } catch (error) {
    const response = rowWriteErrorResponse(error)
    if (response) return response

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
        return handleBatchInsert(requestId, tableId, body, authResult.userId, authResult.authType)
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

      const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
      const rowData = wire.dataIn(validated.data as RowData)

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
          afterRowId: validated.afterRowId,
          beforeRowId: validated.beforeRowId,
        },
        table,
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          row: {
            id: row.id,
            data: wire.dataOut(row.data),
            position: row.position,
            orderKey: row.orderKey ?? undefined,
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

      const response = rowWriteErrorResponse(error)
      if (response) return response

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
      const afterParam = searchParams.get('after')
      const limit = searchParams.get('limit')
      const offset = searchParams.get('offset')
      const includeTotalParam = searchParams.get('includeTotal')

      let filter: Record<string, unknown> | undefined
      let sort: Sort | undefined
      let after: TableRowsCursor | undefined

      try {
        if (filterParam) {
          filter = JSON.parse(filterParam) as Record<string, unknown>
        }
        if (sortParam) {
          sort = JSON.parse(sortParam) as Sort
        }
        if (afterParam) {
          after = JSON.parse(afterParam) as TableRowsCursor
        }
      } catch {
        return NextResponse.json({ error: 'Invalid filter, sort, or after JSON' }, { status: 400 })
      }

      const validated = tableRowsQuerySchema.parse({
        workspaceId,
        filter,
        sort,
        after,
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

      const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
      const result = await queryRows(
        table,
        {
          filter: validated.filter ? wire.filterIn(validated.filter as Filter) : undefined,
          sort: validated.sort ? wire.sortIn(validated.sort) : undefined,
          limit: validated.limit,
          offset: validated.offset,
          after: validated.after,
          includeTotal: validated.includeTotal,
        },
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          rows: result.rows.map((r) => ({
            id: r.id,
            data: wire.dataOut(r.data),
            executions: r.executions,
            position: r.position,
            orderKey: r.orderKey ?? undefined,
            createdAt:
              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            updatedAt:
              r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
          })),
          rowCount: result.rowCount,
          totalCount: result.totalCount,
          limit: result.limit,
          offset: result.offset,
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

      const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
      const patchData = wire.dataIn(validated.data as RowData)

      const sizeValidation = validateRowSize(patchData)
      if (!sizeValidation.valid) {
        return NextResponse.json(
          { error: 'Invalid row data', details: sizeValidation.errors },
          { status: 400 }
        )
      }

      const result = await updateRowsByFilter(
        table,
        {
          filter: wire.filterIn(validated.filter as Filter),
          data: patchData,
          limit: validated.limit,
          actorUserId: authResult.userId,
        },
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

      const response = rowWriteErrorResponse(error)
      if (response) return response

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

      const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
      const result = await deleteRowsByFilter(
        table,
        {
          filter: wire.filterIn(validated.filter as Filter),
          limit: validated.limit,
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

      const response = rowWriteErrorResponse(error)
      if (response) return response

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
          actorUserId: authResult.userId,
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

      const response = rowWriteErrorResponse(error)
      if (response) return response

      logger.error(`[${requestId}] Error batch updating rows:`, error)
      return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 })
    }
  }
)
