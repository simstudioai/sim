import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getRowById } from '@/lib/table'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunWorkflowColumnAPI')

const RunSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  columnName: z.string().min(1, 'Column name is required'),
})

interface RouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/**
 * POST /api/table/[tableId]/rows/[rowId]/run-workflow-column
 * Manually (re-)runs a workflow column for a specific row. Bypasses the scheduler's
 * eligibility predicate — `runWorkflowColumn` writes the cell to `running` as its first
 * step, clearing any prior output/error state.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = RunSchema.parse(body)

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const column = table.schema.columns.find((c) => c.name === validated.columnName)
    if (!column || column.type !== 'workflow' || !column.workflowConfig?.workflowId) {
      return NextResponse.json(
        { error: 'Column is not a configured workflow column' },
        { status: 400 }
      )
    }

    const row = await getRowById(tableId, rowId, validated.workspaceId)
    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    const executionId = generateId()
    const workflowId = column.workflowConfig.workflowId

    void runWorkflowColumn({
      tableId,
      tableName: table.name,
      rowId,
      columnName: validated.columnName,
      workflowId,
      workspaceId: validated.workspaceId,
      executionId,
    })

    return NextResponse.json({ success: true, data: { executionId } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] run-workflow-column failed for ${tableId}/${rowId}:`, error)
    return NextResponse.json({ error: 'Failed to run workflow column' }, { status: 500 })
  }
}
