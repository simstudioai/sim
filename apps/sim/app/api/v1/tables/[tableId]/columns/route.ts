import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  addTableColumn,
  deleteColumn,
  renameColumn,
  updateColumnConstraints,
  updateColumnType,
} from '@/lib/table'
import {
  accessError,
  CreateColumnSchema,
  checkAccess,
  DeleteColumnSchema,
  normalizeColumn,
  UpdateColumnSchema,
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
export async function POST(request: NextRequest, { params }: ColumnsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = CreateColumnSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      if (error.message.includes('already exists') || error.message.includes('maximum column')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error.message === 'Table not found') {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
    }

    logger.error(`[${requestId}] Error adding column to table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to add column' }, { status: 500 })
  }
}

/** PATCH /api/v1/tables/[tableId]/columns — Update a column (rename, type change, constraints). */
export async function PATCH(request: NextRequest, { params }: ColumnsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = UpdateColumnSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

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
        msg.includes('duplicate')
      ) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    logger.error(`[${requestId}] Error updating column in table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to update column' }, { status: 500 })
  }
}

/** DELETE /api/v1/tables/[tableId]/columns — Delete a column from the table schema. */
export async function DELETE(request: NextRequest, { params }: ColumnsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const rateLimit = await checkRateLimit(request, 'table-columns')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = DeleteColumnSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message === 'Table not found') {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      if (error.message.includes('Cannot delete') || error.message.includes('last column')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    logger.error(`[${requestId}] Error deleting column from table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 })
  }
}
