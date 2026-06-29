import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2AddTableColumnContract,
  v2DeleteTableColumnContract,
  v2UpdateTableColumnContract,
} from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  addTableColumn,
  deleteColumn,
  renameColumn,
  updateColumnConstraints,
  updateColumnType,
} from '@/lib/table'
import { checkAccess, normalizeColumn } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableColumnsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ColumnsRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/v2/tables/[tableId]/columns — Add a column to the table schema. */
export const POST = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2AddTableColumnContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return v2TableAccessError(result)

    const { table } = result
    if (table.workspaceId !== validated.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const updatedTable = await addTableColumn(tableId, validated.column, requestId)

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

    return v2Data({ columns: updatedTable.schema.columns.map(normalizeColumn) }, { rateLimit })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    if (error instanceof Error) {
      if (error.message.includes('already exists') || error.message.includes('maximum column')) {
        return v2Error('BAD_REQUEST', error.message)
      }
      if (error.message === 'Table not found') {
        return v2Error('NOT_FOUND', error.message)
      }
    }

    logger.error(`[${requestId}] Error adding column to table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/tables/[tableId]/columns — Update a column (rename, type change, constraints). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: ColumnsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2UpdateTableColumnContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return v2TableAccessError(result)

    const { table } = result
    if (table.workspaceId !== validated.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const { updates } = validated
    let updatedTable = null

    if (updates.name) {
      updatedTable = await renameColumn(
        { tableId, oldName: validated.columnName, newName: updates.name },
        requestId
      )
    }

    if (updates.type) {
      updatedTable = await updateColumnType(
        { tableId, columnName: updates.name ?? validated.columnName, newType: updates.type },
        requestId
      )
    }

    if (updates.required !== undefined || updates.unique !== undefined) {
      updatedTable = await updateColumnConstraints(
        {
          tableId,
          columnName: updates.name ?? validated.columnName,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
        },
        requestId
      )
    }

    if (!updatedTable) {
      return v2Error('BAD_REQUEST', 'No updates specified')
    }

    recordAudit({
      workspaceId: validated.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: `Updated column "${validated.columnName}" in table "${table.name}"`,
      metadata: { columnName: validated.columnName, updates },
      request,
    })

    return v2Data({ columns: updatedTable.schema.columns.map(normalizeColumn) }, { rateLimit })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    if (error instanceof Error) {
      const msg = error.message
      if (msg.includes('not found') || msg.includes('Table not found')) {
        return v2Error('NOT_FOUND', msg)
      }
      if (
        msg.includes('already exists') ||
        msg.includes('Cannot delete the last column') ||
        msg.includes('Cannot set column') ||
        msg.includes('Invalid column') ||
        msg.includes('exceeds maximum') ||
        msg.includes('incompatible') ||
        msg.includes('duplicate')
      ) {
        return v2Error('BAD_REQUEST', msg)
      }
    }

    logger.error(`[${requestId}] Error updating column in table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/tables/[tableId]/columns — Delete a column from the table schema. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: ColumnsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-columns')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2DeleteTableColumnContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      const { table } = result
      if (table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const updatedTable = await deleteColumn(
        { tableId, columnName: validated.columnName },
        requestId
      )

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

      return v2Data({ columns: updatedTable.schema.columns.map(normalizeColumn) }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message === 'Table not found') {
          return v2Error('NOT_FOUND', error.message)
        }
        if (error.message.includes('Cannot delete') || error.message.includes('last column')) {
          return v2Error('BAD_REQUEST', error.message)
        }
      }

      logger.error(`[${requestId}] Error deleting column from table`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
