import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelTableJobContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { appendTableEvent } from '@/lib/table/events'
import { getTableJob, markJobCanceled } from '@/lib/table/jobs/service'
import type { TableJobType } from '@/lib/table/types'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableJobCancelAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/job/cancel
 *
 * Cancels an in-flight async table job (import or delete). Flips the table's job status to
 * `canceled`, which makes the detached worker's next ownership check fail so it stops. Committed
 * work (inserted/deleted rows) is left in place (no rollback). No-op if the job already finished.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(cancelTableJobContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, jobId } = parsed.data.body

  const access = await checkAccess(tableId, authResult.userId, 'write')
  if (!access.ok) return accessError(access, requestId, tableId)
  if (access.table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

  // Resolve the job's actual type (from its own row — the table-level derivation excludes
  // exports) so the cancel event carries the right `type`.
  const job = await getTableJob(tableId, jobId)
  const type = (job?.type ?? 'import') as TableJobType

  const canceled = await markJobCanceled(tableId, jobId)
  if (canceled) {
    void appendTableEvent({ kind: 'job', type, tableId, jobId, status: 'canceled' })
  }
  logger.info(`[${requestId}] Job cancel requested`, { tableId, jobId, type, canceled })

  return NextResponse.json({ success: true, data: { canceled } })
})
