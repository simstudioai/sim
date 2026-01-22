import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { RowData, TableSchema } from '@/lib/table'
import { getUniqueColumns, validateRowData } from '@/lib/table'
import { accessError, checkAccess, verifyTableWorkspace } from '../../../utils'

const logger = createLogger('TableUpsertAPI')

const UpsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
})

interface UpsertRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/rows/upsert - Inserts or updates based on unique columns. */
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

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    const isValidWorkspace = await verifyTableWorkspace(tableId, validated.workspaceId)
    if (!isValidWorkspace) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const schema = table.schema as TableSchema
    const rowData = validated.data as RowData

    const validation = await validateRowData({
      rowData,
      schema,
      tableId,
      checkUnique: false,
    })
    if (!validation.valid) return validation.response

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

    const uniqueFilters = uniqueColumns.map((col) => {
      const value = rowData[col.name]
      if (value === undefined || value === null) {
        return null
      }
      return sql`${userTableRows.data}->>${col.name} = ${String(value)}`
    })

    const validUniqueFilters = uniqueFilters.filter((f): f is Exclude<typeof f, null> => f !== null)

    if (validUniqueFilters.length === 0) {
      return NextResponse.json(
        {
          error: `Upsert requires values for at least one unique field: ${uniqueColumns.map((c) => c.name).join(', ')}`,
        },
        { status: 400 }
      )
    }

    const [existingRow] = await db
      .select()
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId),
          or(...validUniqueFilters)
        )
      )
      .limit(1)

    const now = new Date()

    if (!existingRow && table.rowCount >= table.maxRows) {
      return NextResponse.json(
        { error: `Table row limit reached (${table.maxRows} rows max)` },
        { status: 400 }
      )
    }

    const upsertResult = await db.transaction(async (trx) => {
      if (existingRow) {
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

      const [insertedRow] = await trx
        .insert(userTableRows)
        .values({
          id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
          tableId,
          workspaceId: validated.workspaceId,
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
      `[${requestId}] Upserted (${upsertResult.operation}) row ${upsertResult.row.id} in table ${tableId}`
    )

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: upsertResult.row.id,
          data: upsertResult.row.data,
          createdAt: upsertResult.row.createdAt.toISOString(),
          updatedAt: upsertResult.row.updatedAt.toISOString(),
        },
        operation: upsertResult.operation,
        message: `Row ${upsertResult.operation === 'update' ? 'updated' : 'inserted'} successfully`,
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
