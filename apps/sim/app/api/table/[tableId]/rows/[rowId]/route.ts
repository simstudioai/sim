import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
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
import { checkTableAccess, checkTableWriteAccess, verifyTableWorkspace } from '../../../utils'

const logger = createLogger('TableRowAPI')

/**
 * Type for dynamic row data stored in tables.
 * Keys are column names, values can be any JSON-serializable type.
 */
type RowData = Record<string, unknown>

/**
 * Zod schema for validating get row requests.
 *
 * The workspaceId is optional for backward compatibility but
 * is validated via table access checks when provided.
 */
const GetRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
})

/**
 * Zod schema for validating update row requests.
 */
const UpdateRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

/**
 * Zod schema for validating delete row requests.
 */
const DeleteRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
})

/**
 * Route params for single row endpoints.
 */
interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/**
 * GET /api/table/[tableId]/rows/[rowId]?workspaceId=xxx
 *
 * Retrieves a single row by its ID.
 *
 * @param request - The incoming HTTP request
 * @param context - Route context containing tableId and rowId params
 * @returns JSON response with row data or error
 *
 * @example Response:
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "row": {
 *       "id": "row_abc123",
 *       "data": { "name": "John", "email": "john@example.com" },
 *       "createdAt": "2024-01-01T00:00:00.000Z",
 *       "updatedAt": "2024-01-01T00:00:00.000Z"
 *     }
 *   }
 * }
 * ```
 */
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

    // Check table access (centralized access control)
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

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
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

/**
 * PATCH /api/table/[tableId]/rows/[rowId]
 *
 * Updates an existing row with new data.
 *
 * @param request - The incoming HTTP request with update data
 * @param context - Route context containing tableId and rowId params
 * @returns JSON response with updated row or error
 *
 * @remarks
 * The entire row data must be provided; this is a full replacement,
 * not a partial update.
 *
 * @example Request body:
 * ```json
 * {
 *   "data": { "name": "Jane", "email": "jane@example.com" }
 * }
 * ```
 */
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

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to update row in unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Get table definition
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    const rowData = validated.data as RowData

    // Validate row size
    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(rowData, table.schema as TableSchema)
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
        rowData,
        table.schema as TableSchema,
        existingRows.map((r) => ({ id: r.id, data: r.data as RowData })),
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

/**
 * DELETE /api/table/[tableId]/rows/[rowId]
 *
 * Permanently deletes a single row.
 *
 * @param request - The incoming HTTP request
 * @param context - Route context containing tableId and rowId params
 * @returns JSON response confirming deletion or error
 *
 * @example Request body:
 * ```json
 * {
 *   "workspaceId": "ws_123"
 * }
 * ```
 */
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

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to delete row from unauthorized table ${tableId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    const actualWorkspaceId = validated.workspaceId || accessCheck.table.workspaceId
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessCheck.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Delete row
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
