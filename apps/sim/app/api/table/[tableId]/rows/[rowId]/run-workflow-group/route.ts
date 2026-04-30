import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { updateRow } from '@/lib/table'
import type { RowExecutionMetadata } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunWorkflowGroupAPI')

const RunSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  groupId: z.string().min(1, 'Group ID is required'),
})

interface RouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/**
 * POST /api/table/[tableId]/rows/[rowId]/run-workflow-group
 *
 * Manually (re-)runs a workflow group for a single row by force-resetting
 * `executions[groupId]` to `pending`. The `updateRow` call fires the
 * scheduler which enqueues the cell job.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
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

    const group = (table.schema.workflowGroups ?? []).find((g) => g.id === validated.groupId)
    if (!group) {
      return NextResponse.json({ error: 'Workflow group not found' }, { status: 404 })
    }

    const executionId = generateId()
    const pendingExec: RowExecutionMetadata = {
      status: 'pending',
      executionId,
      jobId: null,
      workflowId: group.workflowId,
      error: null,
    }
    // Clear the group's output cells so the rerun starts visually fresh —
    // otherwise stale values from the previous run linger in the UI until the
    // new run writes new ones (or doesn't, on error/router-skip).
    const clearedData = Object.fromEntries(
      group.outputs.map((o) => [o.columnName, null])
    )
    await updateRow(
      {
        tableId,
        rowId,
        data: clearedData,
        workspaceId: validated.workspaceId,
        executionsPatch: { [validated.groupId]: pendingExec },
      },
      table,
      requestId
    )

    return NextResponse.json({ success: true, data: { executionId } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    if (error instanceof Error && error.message === 'Row not found') {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }
    logger.error(`run-workflow-group failed for ${tableId}/${rowId}:`, error)
    return NextResponse.json({ error: 'Failed to run workflow group' }, { status: 500 })
  }
})
