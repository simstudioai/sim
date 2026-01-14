import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { TableSchema } from '@/lib/table'
import { getUniqueColumns, validateRowAgainstSchema, validateRowSize } from '@/lib/table'
import { checkTableWriteAccess, verifyTableWorkspace } from '../../../utils'

const logger = createLogger('TableUpsertAPI')

/**
 * Type for dynamic row data stored in tables.
 * Keys are column names, values can be any JSON-serializable type.
 */
type RowData = Record<string, unknown>

/**
 * Zod schema for validating upsert (insert or update) requests.
 *
 * If a row with matching unique field(s) exists, it will be updated.
 * Otherwise, a new row will be inserted.
 *
 * @remarks
 * The workspaceId is optional for backward compatibility but
 * is validated via table access checks when provided.
 */
const UpsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

/**
 * Route params for upsert endpoint.
 */
interface UpsertRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/rows/upsert
 *
 * Inserts or updates a row based on unique column constraints.
 * If a row with matching unique field(s) exists, it will be updated;
 * otherwise, a new row will be inserted.
 *
 * @param request - The incoming HTTP request with row data
 * @param context - Route context containing tableId param
 * @returns JSON response with upserted row and operation type
 *
 * @remarks
 * Requires at least one unique column in the table schema.
 * The operation is determined by checking existing rows against
 * the unique field values provided in the request.
 *
 * @example Request body:
 * ```json
 * {
 *   "workspaceId": "ws_123",
 *   "data": { "email": "john@example.com", "name": "John Doe" }
 * }
 * ```
 *
 * @example Response (insert):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "row": { ... },
 *     "operation": "insert",
 *     "message": "Row inserted successfully"
 *   }
 * }
 * ```
 *
 * @example Response (update):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "row": { ... },
 *     "operation": "update",
 *     "message": "Row updated successfully"
 *   }
 * }
 * ```
 */
export async function POST(request: NextRequest, { params }: UpsertRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const validated = UpsertRowSchema.parse(body)

    // Check table write access (centralized access control)
    const accessCheck = await checkTableWriteAccess(tableId, authResult.userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Table not found: ${tableId}`)
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${authResult.userId} attempted to upsert row in unauthorized table ${tableId}`
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

    const schema = table.schema as TableSchema
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
    const rowValidation = validateRowAgainstSchema(rowData, schema)
    if (!rowValidation.valid) {
      return NextResponse.json(
        { error: 'Row data does not match schema', details: rowValidation.errors },
        { status: 400 }
      )
    }

    // Get unique columns
    const uniqueColumns = getUniqueColumns(schema)

    if (uniqueColumns.length === 0) {
      return NextResponse.json(
        {
          error:
            'Upsert requires at least one unique column in the schema. Please add a unique constraint to a column or use insert instead.',
        },
        { status: 400 }
      )
    }

    // Build filter to find existing row by unique fields
    const uniqueFilters = uniqueColumns.map((col) => {
      const value = rowData[col.name]
      if (value === undefined || value === null) {
        return null
      }
      return sql`${userTableRows.data}->>${col.name} = ${String(value)}`
    })

    // Filter out null conditions (for optional unique fields that weren't provided)
    const validUniqueFilters = uniqueFilters.filter((f): f is Exclude<typeof f, null> => f !== null)

    if (validUniqueFilters.length === 0) {
      return NextResponse.json(
        {
          error: `Upsert requires values for at least one unique field: ${uniqueColumns.map((c) => c.name).join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Find existing row with matching unique field(s)
    const [existingRow] = await db
      .select()
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, actualWorkspaceId),
          ...validUniqueFilters
        )
      )
      .limit(1)

    const now = new Date()

    if (existingRow) {
      // Update existing row
      const [updatedRow] = await db
        .update(userTableRows)
        .set({
          data: validated.data,
          updatedAt: now,
        })
        .where(eq(userTableRows.id, existingRow.id))
        .returning()

      logger.info(`[${requestId}] Upserted (updated) row ${updatedRow.id} in table ${tableId}`)

      return NextResponse.json({
        success: true,
        data: {
          row: {
            id: updatedRow.id,
            data: updatedRow.data,
            createdAt: updatedRow.createdAt.toISOString(),
            updatedAt: updatedRow.updatedAt.toISOString(),
          },
          operation: 'update',
          message: 'Row updated successfully',
        },
      })
    }
    // Insert new row
    const [insertedRow] = await db
      .insert(userTableRows)
      .values({
        tableId,
        workspaceId: actualWorkspaceId,
        data: validated.data,
        createdAt: now,
        updatedAt: now,
        createdBy: authResult.userId,
      })
      .returning()

    // Update row count
    await db
      .update(userTableDefinitions)
      .set({
        rowCount: sql`${userTableDefinitions.rowCount} + 1`,
        updatedAt: now,
      })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Upserted (inserted) row ${insertedRow.id} in table ${tableId}`)

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: insertedRow.id,
          data: insertedRow.data,
          createdAt: insertedRow.createdAt.toISOString(),
          updatedAt: insertedRow.updatedAt.toISOString(),
        },
        operation: 'insert',
        message: 'Row inserted successfully',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error upserting row:`, error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const detailedError = `Failed to upsert row: ${errorMessage}`

    return NextResponse.json({ error: detailedError }, { status: 500 })
  }
}
