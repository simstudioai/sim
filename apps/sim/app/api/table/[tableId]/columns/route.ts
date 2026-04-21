import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
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

const logger = createLogger('TableColumnsAPI')

interface ColumnsRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/columns - Adds a column to the table schema. */
export const POST = withRouteHandler(
  async (request: NextRequest, { params }: ColumnsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized column creation attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const body = await request.json()
      const validated = CreateColumnSchema.parse(body)

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const updatedTable = await addTableColumn(tableId, validated.column, requestId)

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
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
)

/** PATCH /api/table/[tableId]/columns - Updates a column (rename, type change, constraints). */
export const PATCH = withRouteHandler(
  async (request: NextRequest, { params }: ColumnsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized column update attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const body = await request.json()
      const validated = UpdateColumnSchema.parse(body)

      const result = await checkAccess(tableId, authResult.userId, 'write')
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

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
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
)

/** DELETE /api/table/[tableId]/columns - Deletes a column from the table schema. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: ColumnsRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized column deletion attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const body = await request.json()
      const validated = DeleteColumnSchema.parse(body)

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

      return NextResponse.json({
        success: true,
        data: {
          columns: updatedTable.schema.columns.map(normalizeColumn),
        },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
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
)
