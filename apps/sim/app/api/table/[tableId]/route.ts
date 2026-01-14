import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { checkTableAccess, checkTableWriteAccess } from '../utils'

const logger = createLogger('TableDetailAPI')

const GetTableSchema = z.object({
  workspaceId: z.string().min(1).optional(), // Optional for backward compatibility
})

/**
 * GET /api/table/[tableId]?workspaceId=xxx
 * Get table details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table access attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Check table access (similar to knowledge base access control)
    const accessCheck = await checkTableAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to access unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get table (workspaceId validation is now handled by access check)
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved table ${tableId} for user ${authResult.userId}`)

    return NextResponse.json({
      table: {
        id: table.id,
        name: table.name,
        description: table.description,
        schema: {
          columns: (table.schema as any).columns.map((col: any) => ({
            name: col.name,
            type: col.type,
            required: col.required ?? false,
            unique: col.unique ?? false,
          })),
        },
        rowCount: table.rowCount,
        maxRows: table.maxRows,
        createdAt: table.createdAt.toISOString(),
        updatedAt: table.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error getting table:`, error)
    return NextResponse.json({ error: 'Failed to get table' }, { status: 500 })
  }
}

/**
 * DELETE /api/table/[tableId]?workspaceId=xxx
 * Delete a table (hard delete)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(_request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table delete attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Check table write access (similar to knowledge base write access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to delete unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Delete all rows first
    await db.delete(userTableRows).where(eq(userTableRows.tableId, tableId))

    // Hard delete table
    const [deletedTable] = await db
      .delete(userTableDefinitions)
      .where(eq(userTableDefinitions.id, tableId))
      .returning()

    if (!deletedTable) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Deleted table ${tableId} for user ${authResult.userId}`)

    return NextResponse.json({
      message: 'Table deleted successfully',
      success: true,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting table:`, error)
    return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 })
  }
}
