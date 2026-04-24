import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableCancelRunsAPI')

const CancelRunsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  scope: z.enum(['all', 'row']),
  rowId: z.string().min(1).optional(),
})

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/cancel-runs
 *
 * Cancels in-flight and queued workflow-column runs for this table.
 *
 * Scopes:
 * - `all`: every running/queued cell in the table
 * - `row`: every running/queued cell for the given `rowId`
 *
 * Current implementation is a stub: it authorizes the request and returns success.
 * Real cancellation requires a Redis pubsub signal plus a DB-backed "cancel requested"
 * flag so multi-replica deploys can abort AbortControllers held on any instance.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = CancelRunsSchema.parse(body)

    if (validated.scope === 'row' && !validated.rowId) {
      return NextResponse.json(
        { error: 'rowId is required when scope is "row"' },
        { status: 400 }
      )
    }

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    logger.info(
      `[${requestId}] cancel-runs requested: tableId=${tableId} scope=${validated.scope}${
        validated.rowId ? ` rowId=${validated.rowId}` : ''
      } (stub — Redis pubsub not yet wired)`
    )

    return NextResponse.json({ success: true, data: { cancelled: 0 } })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] cancel-runs failed for ${tableId}:`, error)
    return NextResponse.json({ error: 'Failed to cancel runs' }, { status: 500 })
  }
}
