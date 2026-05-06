import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeleteTableRowContract,
  v1GetTableRowContract,
  v1UpdateTableRowContract,
} from '@/lib/api/contracts/v1/tables'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData } from '@/lib/table'
import { updateRow } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableRowAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/v1/tables/[tableId]/rows/[rowId] — Get a single row. */
export const GET = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1GetTableRowContract, request, context, {
      validationErrorResponse: () =>
        NextResponse.json({ error: 'workspaceId query parameter is required' }, { status: 400 }),
    })
    if (!parsed.success) return parsed.response
    const { tableId, rowId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    if (result.table.workspaceId !== workspaceId) {
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
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

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
    logger.error(`[${requestId}] Error getting row:`, error)
    return NextResponse.json({ error: 'Failed to get row' }, { status: 500 })
  }
})

/** PATCH /api/v1/tables/[tableId]/rows/[rowId] — Partial update a single row. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1UpdateTableRowContract, request, context)
    if (!parsed.success) return parsed.response
    const { tableId, rowId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'write')
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
    // No `cancellationGuard` is passed here, so `updateRow` can't return null
    // from this caller. Defensive narrowing for TypeScript.
    if (!updatedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

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
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

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

/** DELETE /api/v1/tables/[tableId]/rows/[rowId] — Delete a single row. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1DeleteTableRowContract, request, context, {
      validationErrorResponse: () =>
        NextResponse.json({ error: 'workspaceId query parameter is required' }, { status: 400 }),
    })
    if (!parsed.success) return parsed.response
    const { tableId, rowId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    if (result.table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const [deletedRow] = await db
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .returning()

    if (!deletedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Row deleted successfully',
        deletedCount: 1,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting row:`, error)
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 })
  }
})
