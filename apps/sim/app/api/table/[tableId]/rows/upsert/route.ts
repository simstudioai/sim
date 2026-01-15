import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { RowData, TableSchema } from '@/lib/table'
import { getUniqueColumns, validateRowData } from '@/lib/table'
import { checkAccessOrRespond, getTableById, verifyTableWorkspace } from '../../../utils'

const logger = createLogger('TableUpsertAPI')

/** Zod schema for upsert requests - inserts new row or updates if unique fields match */
const UpsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
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
 * Requires at least one unique column in the table schema.
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

    // Check table write access
    const accessResult = await checkAccessOrRespond(tableId, authResult.userId, requestId, 'write')
    if (accessResult instanceof NextResponse) return accessResult

    // Security check: If workspaceId is provided, verify it matches the table's workspace
    const actualWorkspaceId = validated.workspaceId || accessResult.table.workspaceId
    if (validated.workspaceId) {
      const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
      if (!isValidWorkspace) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${accessResult.table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }
    }

    // Get table definition
    const table = await getTableById(tableId)
    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    const schema = table.schema as TableSchema
    const rowData = validated.data as RowData

    // Validate row data (size and schema only - unique constraints handled by upsert logic)
    const validation = await validateRowData({
      rowData,
      schema,
      tableId,
      checkUnique: false, // Upsert uses unique columns differently - to find existing rows
    })
    if (!validation.valid) return validation.response

    // Get unique columns for upsert matching
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

    // Perform upsert in a transaction to ensure atomicity
    const result = await db.transaction(async (trx) => {
      if (existingRow) {
        // Update existing row
        const [updatedRow] = await trx
          .update(userTableRows)
          .set({
            data: validated.data,
            updatedAt: now,
          })
          .where(eq(userTableRows.id, existingRow.id))
          .returning()

        return {
          row: updatedRow,
          operation: 'update' as const,
        }
      }

      // Insert new row
      const [insertedRow] = await trx
        .insert(userTableRows)
        .values({
          id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
          tableId,
          workspaceId: actualWorkspaceId,
          data: validated.data,
          createdAt: now,
          updatedAt: now,
          createdBy: authResult.userId,
        })
        .returning()

      return {
        row: insertedRow,
        operation: 'insert' as const,
      }
    })

    logger.info(
      `[${requestId}] Upserted (${result.operation}) row ${result.row.id} in table ${tableId}`
    )

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: result.row.id,
          data: result.row.data,
          createdAt: result.row.createdAt.toISOString(),
          updatedAt: result.row.updatedAt.toISOString(),
        },
        operation: result.operation,
        message: `Row ${result.operation === 'update' ? 'updated' : 'inserted'} successfully`,
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
