import { db } from '@sim/db'
import { permissions, userTableDefinitions, userTableRows, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('TableDetailAPI')

const GetTableSchema = z.object({
  workspaceId: z.string().min(1),
})

/**
 * Check if user has write access to workspace
 */
async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  const [workspaceData] = await db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspaceData) {
    return { hasAccess: false, canWrite: false }
  }

  if (workspaceData.ownerId === userId) {
    return { hasAccess: true, canWrite: true }
  }

  const [permission] = await db
    .select({
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  if (!permission) {
    return { hasAccess: false, canWrite: false }
  }

  const canWrite = permission.permissionType === 'admin' || permission.permissionType === 'write'

  return {
    hasAccess: true,
    canWrite,
  }
}

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
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = GetTableSchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    // Check workspace access
    const { hasAccess } = await checkWorkspaceAccess(validated.workspaceId, authResult.userId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get table
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved table ${tableId}`)

    return NextResponse.json({
      table: {
        id: table.id,
        name: table.name,
        description: table.description,
        schema: table.schema,
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
 * Delete a table (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = GetTableSchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Soft delete table
    const [deletedTable] = await db
      .update(userTableDefinitions)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .returning()

    if (!deletedTable) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Delete all rows
    await db.delete(userTableRows).where(eq(userTableRows.tableId, tableId))

    logger.info(`[${requestId}] Deleted table ${tableId}`)

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
