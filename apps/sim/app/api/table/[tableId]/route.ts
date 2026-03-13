import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { deleteTable, NAME_PATTERN, renameTable, TABLE_LIMITS, type TableSchema } from '@/lib/table'
import { accessError, checkAccess, normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableDetailAPI')

const GetTableSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId] - Retrieves a single table's details. */
export async function GET(request: NextRequest, { params }: TableRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table access attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = GetTableSchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    logger.info(`[${requestId}] Retrieved table ${tableId} for user ${authResult.userId}`)

    const schemaData = table.schema as TableSchema

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: {
            columns: schemaData.columns.map(normalizeColumn),
          },
          metadata: table.metadata ?? null,
          rowCount: table.rowCount,
          maxRows: table.maxRows,
          createdAt:
            table.createdAt instanceof Date
              ? table.createdAt.toISOString()
              : String(table.createdAt),
          updatedAt:
            table.updatedAt instanceof Date
              ? table.updatedAt.toISOString()
              : String(table.updatedAt),
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

    logger.error(`[${requestId}] Error getting table:`, error)
    return NextResponse.json({ error: 'Failed to get table' }, { status: 500 })
  }
}

const PatchTableSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(
      TABLE_LIMITS.MAX_TABLE_NAME_LENGTH,
      `Name must be at most ${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters`
    )
    .regex(
      NAME_PATTERN,
      'Name must start with letter or underscore, followed by alphanumeric or underscore'
    ),
})

/** PATCH /api/table/[tableId] - Renames a table. */
export async function PATCH(request: NextRequest, { params }: TableRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table rename attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = PatchTableSchema.parse(body)

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updated = await renameTable(tableId, validated.name, requestId)

    return NextResponse.json({
      success: true,
      data: { table: updated },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error renaming table:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename table' },
      { status: 500 }
    )
  }
}

/** DELETE /api/table/[tableId] - Archives a table. */
export async function DELETE(request: NextRequest, { params }: TableRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table delete attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = GetTableSchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    await deleteTable(tableId, requestId)

    return NextResponse.json({
      success: true,
      data: {
        message: 'Table archived successfully',
      },
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
