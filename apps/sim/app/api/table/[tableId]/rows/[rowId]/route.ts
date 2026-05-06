import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteTableRowContract,
  getTableQuerySchema,
  updateTableRowContract,
} from '@/lib/api/contracts/tables'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData } from '@/lib/table'
import { deleteRow, updateRow } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRowAPI')

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/table/[tableId]/rows/[rowId] - Retrieves a single row. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RowRouteParams) => {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = getTableQuerySchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const [row] = await db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        position: userTableRows.position,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved row ${rowId} from table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: row.id,
          data: row.data,
          position: row.position,
          createdAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          updatedAt:
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        },
      },
    })
  } catch (error) {
    if (isZodError(error)) {
      return validationErrorResponse(error)
    }

    logger.error(`[${requestId}] Error getting row:`, error)
    return NextResponse.json({ error: 'Failed to get row' }, { status: 500 })
  }
})

/** PATCH /api/table/[tableId]/rows/[rowId] - Updates a single row (supports partial updates). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(updateTableRowContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const validated = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updatedRow = await updateRow(
      {
        tableId,
        rowId,
        data: validated.data as RowData,
        workspaceId: validated.workspaceId,
      },
      table,
      requestId
    )
    // Only `null` when a `cancellationGuard` is supplied and the SQL guard
    // rejects the write — this route doesn't pass one, so reaching null is a bug.
    if (!updatedRow) throw new Error('updateRow returned null without a cancellationGuard')

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: updatedRow.id,
          data: updatedRow.data,
          position: updatedRow.position,
          createdAt:
            updatedRow.createdAt instanceof Date
              ? updatedRow.createdAt.toISOString()
              : updatedRow.createdAt,
          updatedAt:
            updatedRow.updatedAt instanceof Date
              ? updatedRow.updatedAt.toISOString()
              : updatedRow.updatedAt,
        },
        message: 'Row updated successfully',
      },
    })
  } catch (error) {
    const errorMessage = toError(error).message

    if (errorMessage === 'Row not found') {
      return NextResponse.json({ error: errorMessage }, { status: 404 })
    }

    if (
      errorMessage.includes('Row size exceeds') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('must be unique') ||
      errorMessage.includes('Unique constraint violation') ||
      errorMessage.includes('Cannot set unique column')
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error updating row:`, error)
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 })
  }
})

/** DELETE /api/table/[tableId]/rows/[rowId] - Deletes a single row. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteTableRowContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const validated = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    await deleteRow(tableId, rowId, validated.workspaceId, requestId)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Row deleted successfully',
        deletedCount: 1,
      },
    })
  } catch (error) {
    const errorMessage = toError(error).message

    if (errorMessage === 'Row not found') {
      return NextResponse.json({ error: errorMessage }, { status: 404 })
    }

    logger.error(`[${requestId}] Error deleting row:`, error)
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 })
  }
})
