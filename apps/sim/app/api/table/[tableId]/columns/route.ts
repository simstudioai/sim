import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addTableColumnContract,
  deleteTableColumnContract,
  updateTableColumnContract,
} from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { isZodError, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { addTableColumn, deleteColumn } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { normalizeColumn } from '@/lib/table/wire'
import {
  accessError,
  checkAccess,
  orchestrationOutcomeErrorResponse,
  rootErrorMessage,
  tableLockErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableColumnsAPI')

interface ColumnsRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/columns - Adds a column to the table schema. */
export const POST = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = await context.params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized column creation attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const validation = await parseRequest(addTableColumnContract, request, context)
    if (!validation.success) return validation.response
    const validated = validation.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updatedTable = await addTableColumn(tableId, validated.column, requestId)
    signalTableSchemaChanged(tableId)

    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError
    if (isZodError(error)) {
      return validationErrorResponse(error, 'Invalid request data')
    }

    const msg = rootErrorMessage(error)
    if (
      msg.includes('already exists') ||
      msg.includes('maximum column') ||
      msg.includes('Invalid column') ||
      msg.includes('exceeds maximum') ||
      msg.includes('option')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    if (msg === 'Table not found') {
      return NextResponse.json({ error: msg }, { status: 404 })
    }

    logger.error(`[${requestId}] Error adding column to table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to add column' }, { status: 500 })
  }
})

/** PATCH /api/table/[tableId]/columns - Updates a column (rename, type change, constraints). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = await context.params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized column update attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const validation = await parseRequest(updateTableColumnContract, request, context)
    if (!validation.success) return validation.response
    const validated = validation.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const outcome = await performUpdateTableColumn({
      table,
      columnName: validated.columnName,
      userId: authResult.userId,
      updates: validated.updates,
      requestId,
      request,
    })
    if (!outcome.success || !outcome.table) {
      return orchestrationOutcomeErrorResponse(outcome, 'Failed to update column')
    }

    // Live-collab: tell open viewers the change landed so they refetch.
    signalTableSchemaChanged(tableId)

    return NextResponse.json({
      success: true,
      data: {
        columns: outcome.table.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    if (isZodError(error)) {
      return validationErrorResponse(error, 'Invalid request data')
    }

    logger.error(`[${requestId}] Error updating column in table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to update column' }, { status: 500 })
  }
})

/** DELETE /api/table/[tableId]/columns - Deletes a column from the table schema. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: ColumnsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await context.params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized column deletion attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const validation = await parseRequest(deleteTableColumnContract, request, context)
      if (!validation.success) return validation.response
      const validated = validation.data.body

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const updatedTable = await deleteColumn(
        { tableId, columnName: validated.columnName },
        requestId
      )
      signalTableSchemaChanged(tableId)

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      const lockError = tableLockErrorResponse(error)
      if (lockError) return lockError
      if (isZodError(error)) {
        return validationErrorResponse(error, 'Invalid request data')
      }

      const msg = rootErrorMessage(error)
      if (msg.includes('not found') || msg === 'Table not found') {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      if (msg.includes('Cannot delete') || msg.includes('last column')) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      logger.error(`[${requestId}] Error deleting column from table ${tableId}:`, error)
      return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 })
    }
  }
)
