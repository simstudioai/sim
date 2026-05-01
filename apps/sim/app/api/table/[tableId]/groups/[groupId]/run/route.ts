import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { triggerWorkflowGroupRun } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunGroupAPI')

const RunSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  /**
   * `all` — every dep-satisfied row that isn't already running/pending.
   * `incomplete` — same, but additionally restricted to rows whose group has
   * never run, or whose last run ended in `failed`/`aborted`. Used by the
   * "Run unrun & aborted rows" affordance in the group header.
   */
  mode: z.enum(['all', 'incomplete']).default('all'),
})

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
  const { tableId, groupId } = await params

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

    const { triggered } = await triggerWorkflowGroupRun({
      tableId,
      groupId,
      workspaceId: validated.workspaceId,
      mode: validated.mode,
      requestId,
    })

    return NextResponse.json({ success: true, data: { triggered } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    if (error instanceof Error && error.message === 'Workflow group not found') {
      return NextResponse.json({ error: 'Workflow group not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-group failed for ${tableId}/${groupId}:`, error)
    return NextResponse.json({ error: 'Failed to run group' }, { status: 500 })
  }
})
