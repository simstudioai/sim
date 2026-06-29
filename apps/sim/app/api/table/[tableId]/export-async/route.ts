import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { exportTableAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runTableExport, type TableExportPayload } from '@/lib/table/export-runner'
import { markTableJobRunning, releaseJobClaim } from '@/lib/table/jobs/service'
import type { TableExportJobPayload } from '@/lib/table/types'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableExportAsync')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/export-async
 *
 * Kicks off a background export for large tables (small ones stream synchronously via `/export`).
 * Export jobs are read-only, so they bypass the one-running-job-per-table gate (the partial-unique
 * index excludes `type = 'export'`) — an export can run alongside an import or delete, and the
 * delete-mask keeps a mid-delete export consistent with the delete's outcome.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(exportTableAsyncContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, format } = parsed.data.body

  const access = await checkAccess(tableId, authResult.userId, 'read')
  if (!access.ok) return accessError(access, requestId, tableId)
  if (access.table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

  const jobId = generateId()
  const jobPayload: TableExportJobPayload = { format }
  const claimed = await markTableJobRunning(tableId, jobId, 'export', jobPayload)
  if (!claimed) {
    // Only possible against another running *export*-typed insert race losing on the pkey, or a
    // missing table — the active-job index excludes exports.
    return NextResponse.json({ error: 'Failed to start export' }, { status: 409 })
  }

  const payload: TableExportPayload = {
    jobId,
    tableId,
    workspaceId,
    format,
    userId: authResult.userId,
  }
  if (isTriggerDevEnabled) {
    try {
      const [{ tableExportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-export'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableExportTask>('table-export', payload, {
        tags: [`tableId:${tableId}`, `jobId:${jobId}`],
        region: await resolveTriggerRegion(),
      })
    } catch (error) {
      // A failed dispatch must not leave a ghost `running` job holding the
      // table's one-write-job slot until the stale-job janitor fires.
      await releaseJobClaim(tableId, jobId).catch(() => {})
      throw error
    }
  } else {
    runDetached('table-export', () => runTableExport(payload))
  }

  logger.info(`[${requestId}] Async export started`, { tableId, jobId, format })
  return NextResponse.json({ success: true, data: { tableId, jobId } })
})
