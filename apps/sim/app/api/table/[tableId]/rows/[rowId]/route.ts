import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { RowData, TableSchema } from '@/lib/table'
import { validateRowData } from '@/lib/table'
import {
  checkAccessOrRespond,
  checkTableAccess,
  getTableById,
  verifyTableWorkspace,
} from '../../../utils'

const logger = createLogger('TableRowAPI')

const GetRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

const UpdateRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

const DeleteRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/table/[tableId]/rows/[rowId] - Retrieves a single row. */
export async function GET(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = GetRowSchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const accessCheck = await checkTableAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to access row from unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const actualWorkspaceId = validated.workspaceId
    const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
    if (!isValidWorkspace) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const [row] = await db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, actualWorkspaceId)
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
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error getting row:`, error)
    return NextResponse.json({ error: 'Failed to get row' }, { status: 500 })
  }
}

/** PATCH /api/table/[tableId]/rows/[rowId] - Updates a single row. */
export async function PATCH(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = UpdateRowSchema.parse(body)

    const accessResult = await checkAccessOrRespond(tableId, authResult.userId, requestId, 'write')
    if (accessResult instanceof NextResponse) return accessResult

    const actualWorkspaceId = validated.workspaceId
    const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
    if (!isValidWorkspace) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessResult.table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const table = await getTableById(tableId)
    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    const rowData = validated.data as RowData

    const validation = await validateRowData({
      rowData,
      schema: table.schema as TableSchema,
      tableId,
      excludeRowId: rowId,
    })
    if (!validation.valid) return validation.response

    const now = new Date()

    const [updatedRow] = await db
      .update(userTableRows)
      .set({
        data: validated.data,
        updatedAt: now,
      })
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, actualWorkspaceId)
        )
      )
      .returning()

    if (!updatedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Updated row ${rowId} in table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: updatedRow.id,
          data: updatedRow.data,
          createdAt: updatedRow.createdAt.toISOString(),
          updatedAt: updatedRow.updatedAt.toISOString(),
        },
        message: 'Row updated successfully',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating row:`, error)
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 })
  }
}

/** DELETE /api/table/[tableId]/rows/[rowId] - Deletes a single row. */
export async function DELETE(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = DeleteRowSchema.parse(body)

    const accessResult = await checkAccessOrRespond(tableId, authResult.userId, requestId, 'write')
    if (accessResult instanceof NextResponse) return accessResult

    const actualWorkspaceId = validated.workspaceId
    const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
    if (!isValidWorkspace) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessResult.table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const [deletedRow] = await db
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, actualWorkspaceId)
        )
      )
      .returning()

    if (!deletedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Deleted row ${rowId} from table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Row deleted successfully',
        deletedCount: 1,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting row:`, error)
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 })
  }
}
