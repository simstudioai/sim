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
import {
  addTableColumn,
  deleteColumn,
  renameColumn,
  updateColumnConstraints,
  updateColumnCurrency,
  updateColumnOptions,
  updateColumnType,
} from '@/lib/table'
import { columnMatchesRef, getColumnId } from '@/lib/table/column-keys'
import { columnTypeById } from '@/lib/table/column-types'
import { isSupportedCurrencyCode } from '@/lib/table/currency'
import { signalTableSchemaChanged } from '@/lib/table/events'
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

    const result = await checkAccess(tableId, userId, 'write')
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

    const parsed = await parseRequest(v1UpdateTableColumnContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
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

    // A payload that repeats the current type must not go through
    // `updateColumnType` — it early-returns on an unchanged type and would drop
    // any `options` alongside it. Only a real type change routes there; an
    // unchanged type with options routes to the options-only update.
    const currentColumn = table.schema.columns.find((c) =>
      columnMatchesRef(c, validated.columnName)
    )
    // Address every write below by the stable id, not the name: a rename folded
    // into one of them must not break the next one's lookup.
    const columnRef = currentColumn ? getColumnId(currentColumn) : validated.columnName
    // The constraints write below is a separate, unconditional step, so it is
    // the last one whenever it runs — that is the write the rename rides on.
    const typeChanging = updates.type !== undefined && updates.type !== currentColumn?.type
    if (!currentColumn) {
      return NextResponse.json(
        { error: `Column "${validated.columnName}" not found` },
        { status: 404 }
      )
    }

    // A retype applies and validates the constraints itself, so the separate
    // constraint write only runs when the type is unchanged. The rename rides
    // whichever write actually runs last.
    const typedWriteRuns =
      typeChanging ||
      updates.currencyCode !== undefined ||
      updates.options !== undefined ||
      updates.multiple !== undefined
    const constraintsWriteRuns =
      !typedWriteRuns && (updates.required !== undefined || updates.unique !== undefined)
    const renameWithTypedWrite =
      updates.name && !constraintsWriteRuns ? { newName: updates.name } : {}

    // Every write below is its own locked transaction, so one that is going to
    // fail leaves the earlier ones committed. These guards reject the knowable
    // cases up front, before any write at all.
    // Gate on the type the column ENDS UP with, not on whether the type is
    // changing: an options-only update on an existing select column carries the
    // same hazard as a conversion does.
    const resultingType = updates.type ?? currentColumn?.type
    if (updates.currencyCode !== undefined) {
      if (resultingType !== 'currency') {
        return NextResponse.json(
          {
            error: `Cannot set currency on column "${validated.columnName}" of type "${resultingType}"`,
          },
          { status: 400 }
        )
      }
      if (!isSupportedCurrencyCode(updates.currencyCode)) {
        return NextResponse.json(
          {
            error: `Invalid currency code "${updates.currencyCode}". Use an ISO 4217 code, e.g. USD`,
          },
          { status: 400 }
        )
      }
    }
    // The rename runs last (see below), so a name already taken would fail after
    // the typed write committed. This is the only rename failure a caller can
    // cause; catching it here leaves just the concurrent-collision race, which
    // no pre-flight check can close.
    if (
      updates.name &&
      table.schema.columns.some(
        (c) =>
          c.name.toLowerCase() === updates.name?.toLowerCase() &&
          !columnMatchesRef(c, validated.columnName)
      )
    ) {
      return NextResponse.json(
        { error: `Column "${updates.name}" already exists` },
        { status: 400 }
      )
    }
    if (
      currentColumn?.workflowGroupId &&
      (updates.required !== undefined || updates.unique !== undefined)
    ) {
      return NextResponse.json(
        {
          error: `Cannot change constraints on workflow-output column "${currentColumn.name}". Constraints aren't applicable to columns whose values come from workflow execution.`,
        },
        { status: 400 }
      )
    }
    if (updates.unique === true && !columnTypeById(resultingType).supportsUnique) {
      return NextResponse.json(
        { error: `Cannot set a ${resultingType} column as unique` },
        { status: 400 }
      )
    }

    if (typeChanging) {
      updatedTable = await updateColumnType(
        {
          tableId,
          columnName: columnRef,
          newType: updates.type as NonNullable<typeof updates.type>,
          ...(updates.options !== undefined ? { options: updates.options } : {}),
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          ...(updates.currencyCode !== undefined ? { currencyCode: updates.currencyCode } : {}),
          // Forwarded so the conversion validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId
      )
    } else if (updates.currencyCode !== undefined) {
      // Re-denominating an existing currency column: schema-only, no cell
      // rewrite. Reached only when the type is unchanged — a conversion INTO
      // currency carries the code through `updateColumnType` above.
      updatedTable = await updateColumnCurrency(
        {
          tableId,
          columnName: columnRef,
          currencyCode: updates.currencyCode,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId
      )
    } else if (updates.options !== undefined || updates.multiple !== undefined) {
      updatedTable = await updateColumnOptions(
        {
          tableId,
          columnName: columnRef,
          options: updates.options ?? currentColumn?.options ?? [],
          ...(updates.multiple !== undefined ? { multiple: updates.multiple } : {}),
          // Forwarded so the removal guard validates against the constraint this
          // same request is about to set, not the column's current one.
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...renameWithTypedWrite,
        },
        requestId
      )
    }

    // Skipped whenever a typed write ran: that write already applied and
    // validated these, in one transaction with the change they accompany.
    if (constraintsWriteRuns) {
      updatedTable = await updateColumnConstraints(
        {
          tableId,
          columnName: columnRef,
          ...(updates.required !== undefined ? { required: updates.required } : {}),
          ...(updates.unique !== undefined ? { unique: updates.unique } : {}),
          ...(updates.name ? { newName: updates.name } : {}),
        },
        requestId
      )
    }

    // A rename rides along with the LAST write above, inside that write's
    // transaction — a rename is metadata-only (rows key on the stable column
    // id), so nothing forces it to be its own write, and folding it in is what
    // stops a combined request from committing one half and then failing. Only
    // a rename with nothing to ride on runs standalone.
    if (updates.name && !updatedTable) {
      updatedTable = await renameColumn(
        { tableId, oldName: columnRef, newName: updates.name },
        requestId
      )
    }

    if (!updatedTable) {
      return NextResponse.json({ error: 'No updates specified' }, { status: 400 })
    }
    signalTableSchemaChanged(tableId)

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
    const validationResponse = v1ValidationErrorResponseFromError(error)
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
        msg.includes('option') ||
        msg.includes('currency') ||
        msg.includes('is already type')
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

      const parsed = await parseRequest(v1DeleteTableColumnContract, request, context, {
        validationErrorResponse: v1ValidationErrorResponse,
      })
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
