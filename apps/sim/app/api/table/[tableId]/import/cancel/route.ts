import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelTableImportContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { appendTableEvent } from '@/lib/table/events'
import { markImportCanceled } from '@/lib/table/service'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableImportCancelAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/import/cancel
 *
 * Cancels an in-flight async CSV import. Flips the table's import status to `canceled`, which makes
 * the detached worker's next ownership check fail so it stops inserting. Committed rows are left in
 * place (no rollback) — the user can delete the table. No-op if the import already finished.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(cancelTableImportContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, importId } = parsed.data.body

  const access = await checkAccess(tableId, authResult.userId, 'write')
  if (!access.ok) return accessError(access, requestId, tableId)
  if (access.table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

  const canceled = await markImportCanceled(tableId, importId)
  if (canceled) {
    void appendTableEvent({ kind: 'import', tableId, importId, status: 'canceled' })
  }
  logger.info(`[${requestId}] Import cancel requested`, { tableId, importId, canceled })

  return NextResponse.json({ success: true, data: { canceled } })
})
