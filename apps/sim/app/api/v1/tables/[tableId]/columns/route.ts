import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1AddTableColumnContract,
  v1DeleteTableColumnContract,
  v1UpdateTableColumnContract,
} from '@/lib/api/contracts/v1/tables'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  addTableColumn,
  deleteColumn,
  renameColumn,
  updateColumnConstraints,
  updateColumnOptions,
  updateColumnType,
} from '@/lib/table'
import { columnMatchesRef } from '@/lib/table/column-keys'
import {
  accessError,
  checkAccess,
  normalizeColumn,
  tableLockErrorResponse,
} from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
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

    const parsed = await parseRequest(v1AddTableColumnContract, request, context)
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
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

    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof Error) {
      // Same caller-error set the internal columns route maps — an invalid
      // select option set is a bad request, not a server fault.
      if (
        error.message.includes('already exists') ||
        error.message.includes('maximum column') ||
        error.message.includes('Invalid column') ||
        error.message.includes('exceeds maximum') ||
        error.message.includes('option')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error.message === 'Table not found') {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
    }

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

    const parsed = await parseRequest(v1UpdateTableColumnContract, request, context)
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const { updates } = validated
    let updatedTable = null

    if (updates.name) {
      updatedTable = await renameColumn(
        { tableId, oldName: validated.columnName, newName: updates.name },
        requestId
      )
    }

    // A payload that repeats the current type must not go through
    // `updateColumnType` — it early-returns on an unchanged type and would drop
    // any `options` alongside it. Only a real type change routes there; an
    // unchanged type with options routes to the options-only update.
    const currentColumn = table.schema.columns.find((c) =>
      columnMatchesRef(c, validated.columnName)
    )
    const typeChanging = updates.type !== undefined && updates.type !== currentColumn?.type

    // Every write below is its own locked transaction, so any of them paired
    // with a constraint write that is going to fail commits and then errors.
    // Gate on the type the column ENDS UP with, not on whether the type is
    // changing: an options-only update on an existing select column carries the
    // same hazard as a conversion does.
    const resultingType = updates.type ?? currentColumn?.type
    if (updates.unique === true && resultingType === 'select') {
      return NextResponse.json({ error: 'Cannot set a select column as unique' }, { status: 400 })
    }

    if (typeChanging) {
      updatedTable = await updateColumnType(
        {
          tableId,
          columnName: updates.name ?? validated.columnName,
          newType: updates.type as NonNullable<typeof updates.type>,
          ...(updates.options !== undefined ? { options: updates.options } : {}),
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          // Forwarded so the conversion validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
        },
        requestId
      )
    } else if (updates.options !== undefined || updates.multiple !== undefined) {
      updatedTable = await updateColumnOptions(
        {
          tableId,
          columnName: updates.name ?? validated.columnName,
          options: updates.options ?? currentColumn?.options ?? [],
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          // Forwarded so the removal guard validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
        },
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
      return NextResponse.json({ error: 'No updates specified' }, { status: 400 })
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

    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof Error) {
      const msg = error.message
      if (msg.includes('not found') || msg.includes('Table not found')) {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      if (
        msg.includes('already exists') ||
        msg.includes('Cannot delete the last column') ||
        msg.includes('Cannot set column') ||
        msg.includes('Invalid column') ||
        msg.includes('exceeds maximum') ||
        msg.includes('incompatible') ||
        msg.includes('duplicate') ||
        msg.includes('option')
      ) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

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

      const parsed = await parseRequest(v1DeleteTableColumnContract, request, context)
      if (!parsed.success) return parsed.response
      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return scopeError

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
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

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      const lockError = tableLockErrorResponse(error)
      if (lockError) return lockError
      const validationResponse = validationErrorResponseFromError(error)
      if (validationResponse) return validationResponse

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message === 'Table not found') {
          return NextResponse.json({ error: error.message }, { status: 404 })
        }
        if (error.message.includes('Cannot delete') || error.message.includes('last column')) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
      }

      logger.error(`[${requestId}] Error deleting column from table:`, error)
      return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 })
    }
  }
)
