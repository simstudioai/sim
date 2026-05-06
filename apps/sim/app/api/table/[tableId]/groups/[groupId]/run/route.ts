import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { runWorkflowGroupContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { triggerWorkflowGroupRun } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunGroupAPI')

interface RouteParams {
  params: Promise<{ tableId: string; groupId: string }>
}

/**
 * POST /api/table/[tableId]/groups/[groupId]/run
 *
 * Manually triggers the workflow group for every eligible row in the table.
 * Each eligible row's `executions[groupId]` is reset to `pending` so the
 * scheduler picks it up and enqueues a per-cell trigger.dev job. Rows whose
 * deps aren't satisfied or whose group is already running are skipped.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(runWorkflowGroupContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId, groupId } = parsed.data.params
    const { workspaceId, runMode, rowIds } = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    const { table } = result

    if (table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const { triggered } = await triggerWorkflowGroupRun({
      tableId,
      groupId,
      workspaceId,
      mode: runMode,
      requestId,
      rowIds,
    })

    return NextResponse.json({ success: true, data: { triggered } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Workflow group not found') {
      return NextResponse.json({ error: 'Workflow group not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-group failed:`, error)
    return NextResponse.json({ error: 'Failed to run group' }, { status: 500 })
  }
})
