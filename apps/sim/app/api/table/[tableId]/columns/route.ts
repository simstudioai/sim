import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { addTableColumn } from '@/lib/table'
import { accessError, checkAccess, normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableColumnsAPI')

const CreateColumnSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  column: z.object({
    name: z.string().min(1, 'Column name is required'),
    type: z.enum(['string', 'number', 'boolean', 'date', 'json']),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
})

interface ColumnsRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/columns - Adds a column to the table schema. */
export async function POST(request: NextRequest, { params }: ColumnsRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized column creation attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = CreateColumnSchema.parse(body)

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updatedTable = await addTableColumn(tableId, validated.column, requestId)

    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      if (error.message.includes('already exists') || error.message.includes('maximum column')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error.message === 'Table not found') {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
    }

    logger.error(`[${requestId}] Error adding column to table ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to add column' }, { status: 500 })
  }
}
