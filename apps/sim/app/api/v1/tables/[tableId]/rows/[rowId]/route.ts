import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { RowData, TableSchema } from '@/lib/table'
import { validateRowData } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1TableRowAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UpdateRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/v1/tables/[tableId]/rows/[rowId] — Get a single row. */
export async function GET(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId, rowId } = await params
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId query parameter is required' },
        { status: 400 }
      )
    }

    const result = await checkAccess(tableId, userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    if (result.table.workspaceId !== workspaceId) {
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
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    })
  } catch (error) {
    logger.error('Error getting row:', error)
    return NextResponse.json({ error: 'Failed to get row' }, { status: 500 })
  }
}

/** PATCH /api/v1/tables/[tableId]/rows/[rowId] — Partial update a single row. */
export async function PATCH(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId, rowId } = await params
    const body: unknown = await request.json()
    const validated = UpdateRowSchema.parse(body)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const [existingRow] = await db
      .select({ data: userTableRows.data })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .limit(1)

    if (!existingRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    const mergedData = {
      ...(existingRow.data as RowData),
      ...(validated.data as RowData),
    }

    const validation = await validateRowData({
      rowData: mergedData,
      schema: table.schema as TableSchema,
      tableId,
      excludeRowId: rowId,
    })
    if (!validation.valid) return validation.response

    const now = new Date()

    const [updatedRow] = await db
      .update(userTableRows)
      .set({
        data: mergedData,
        updatedAt: now,
      })
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .returning()

    if (!updatedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

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

    logger.error('Error updating row:', error)
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 })
  }
}

/** DELETE /api/v1/tables/[tableId]/rows/[rowId] — Delete a single row. */
export async function DELETE(request: NextRequest, { params }: RowRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId, rowId } = await params
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId query parameter is required' },
        { status: 400 }
      )
    }

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
    logger.error('Error deleting row:', error)
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 })
  }
}
