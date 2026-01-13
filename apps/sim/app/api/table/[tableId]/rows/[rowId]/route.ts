import { db } from '@sim/db'
import { permissions, userTableDefinitions, userTableRows, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { TableSchema } from '@/lib/table'
import {
  getUniqueColumns,
  validateRowAgainstSchema,
  validateRowSize,
  validateUniqueConstraints,
} from '@/lib/table'

const logger = createLogger('TableRowAPI')

const GetRowSchema = z.object({
  workspaceId: z.string().min(1),
})

const UpdateRowSchema = z.object({
  workspaceId: z.string().min(1),
  data: z.record(z.any()),
})

const DeleteRowSchema = z.object({
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
 * GET /api/table/[tableId]/rows/[rowId]?workspaceId=xxx
 * Get a single row by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string; rowId: string }> }
) {
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

    // Check workspace access
    const { hasAccess } = await checkWorkspaceAccess(validated.workspaceId, authResult.userId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get row
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
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved row ${rowId} from table ${tableId}`)

    return NextResponse.json({
      row: {
        id: row.id,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
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

/**
 * PATCH /api/table/[tableId]/rows/[rowId]
 * Update an existing row
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string; rowId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = UpdateRowSchema.parse(body)

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get table definition
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

    // Validate row size
    const sizeValidation = validateRowSize(validated.data)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(validated.data, table.schema as TableSchema)
    if (!rowValidation.valid) {
      return NextResponse.json(
        { error: 'Row data does not match schema', details: rowValidation.errors },
        { status: 400 }
      )
    }

    // Check unique constraints if any unique columns exist
    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // Fetch existing rows to check for uniqueness
      const existingRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      const uniqueValidation = validateUniqueConstraints(
        validated.data,
        table.schema as TableSchema,
        existingRows,
        rowId // Exclude the current row being updated
      )

      if (!uniqueValidation.valid) {
        return NextResponse.json(
          { error: 'Unique constraint violation', details: uniqueValidation.errors },
          { status: 400 }
        )
      }
    }

    // Update row
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
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .returning()

    if (!updatedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Updated row ${rowId} in table ${tableId}`)

    return NextResponse.json({
      row: {
        id: updatedRow.id,
        data: updatedRow.data,
        createdAt: updatedRow.createdAt.toISOString(),
        updatedAt: updatedRow.updatedAt.toISOString(),
      },
      message: 'Row updated successfully',
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

/**
 * DELETE /api/table/[tableId]/rows/[rowId]
 * Delete a row
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string; rowId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = DeleteRowSchema.parse(body)

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Delete row
    const [deletedRow] = await db
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .returning()

    if (!deletedRow) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    // Update row count
    await db
      .update(userTableDefinitions)
      .set({
        rowCount: sql`${userTableDefinitions.rowCount} - 1`,
        updatedAt: new Date(),
      })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Deleted row ${rowId} from table ${tableId}`)

    return NextResponse.json({
      message: 'Row deleted successfully',
      deletedCount: 1,
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
