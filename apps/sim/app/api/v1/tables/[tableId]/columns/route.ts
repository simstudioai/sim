import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1AddTableColumnContract,
  v1DeleteTableColumnContract,
  v1UpdateTableColumnContract,
} from '@/lib/api/contracts/v1/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { addTableColumn, deleteColumn } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { normalizeColumn } from '@/lib/table/wire'
import {
  accessError,
  checkAccess,
  orchestrationErrorResponse,
  orchestrationOutcomeErrorResponse,
  tableLockErrorResponse,
} from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
  tableAccessPrincipal,
  v1ValidationErrorResponse,
  v1ValidationErrorResponseFromError,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableColumnsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ColumnsRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/v1/tables/[tableId]/columns — Add a column to the table schema. */
export const POST = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    const parsed = await parseRequest(v1AddTableColumnContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, tableAccessPrincipal(rateLimit), 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updatedTable = await addTableColumn(tableId, validated.column, requestId)
    signalTableSchemaChanged(tableId)

    recordAudit({
      workspaceId: validated.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: `Added column "${validated.column.name}" to table "${table.name}"`,
      metadata: { column: validated.column },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError
    const validationResponse = v1ValidationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    const classified = orchestrationErrorResponse(error)
    if (classified) return classified

    logger.error(`[${requestId}] Error adding column to table:`, error)
    return NextResponse.json({ error: 'Failed to add column' }, { status: 500 })
  }
})

/** PATCH /api/v1/tables/[tableId]/columns — Update a column (rename, type change, constraints). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    const parsed = await parseRequest(v1UpdateTableColumnContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, tableAccessPrincipal(rateLimit), 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const outcome = await performUpdateTableColumn({
      table,
      columnName: validated.columnName,
      userId,
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
    const validationResponse = v1ValidationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    logger.error(`[${requestId}] Error updating column in table:`, error)
    return NextResponse.json({ error: 'Failed to update column' }, { status: 500 })
  }
})

/** DELETE /api/v1/tables/[tableId]/columns — Delete a column from the table schema. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: ColumnsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-columns')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!

      const parsed = await parseRequest(v1DeleteTableColumnContract, request, context, {
        validationErrorResponse: v1ValidationErrorResponse,
      })
      if (!parsed.success) return parsed.response
      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return scopeError

      const result = await checkAccess(tableId, tableAccessPrincipal(rateLimit), 'write')
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

      recordAudit({
        workspaceId: validated.workspaceId,
        actorId: userId,
        action: AuditAction.TABLE_UPDATED,
        resourceType: AuditResourceType.TABLE,
        resourceId: tableId,
        resourceName: table.name,
        description: `Deleted column "${validated.columnName}" from table "${table.name}"`,
        metadata: { columnName: validated.columnName },
        request,
      })

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      const lockError = tableLockErrorResponse(error)
      if (lockError) return lockError
      const validationResponse = v1ValidationErrorResponseFromError(error)
      if (validationResponse) return validationResponse

      const classified = orchestrationErrorResponse(error)
      if (classified) return classified

      logger.error(`[${requestId}] Error deleting column from table:`, error)
      return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 })
    }
  }
)
