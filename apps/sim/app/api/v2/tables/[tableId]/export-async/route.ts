import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { v2ExportTableAsyncContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { runTableExport, type TableExportPayload } from '@/lib/table/export-runner'
import { markTableJobRunning, releaseJobClaim } from '@/lib/table/jobs/service'
import type { TableExportJobPayload } from '@/lib/table/types'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2TableExportAsyncAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/export-async — Start a background export.
 *
 * Export jobs are read-only, so they bypass the one-write-job-per-table gate
 * (the partial-unique index excludes them) and can run alongside an import or
 * delete. Poll `GET /api/v2/tables/jobs`, then fetch the file from
 * `GET /export/download` once the job reports `ready`.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-export')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2ExportTableAsyncContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, format } = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!access.ok || access.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const jobId = generateId()
    const jobPayload: TableExportJobPayload = { format }
    if (!(await markTableJobRunning(tableId, jobId, 'export', jobPayload))) {
      return v2Error('CONFLICT', 'Failed to start export')
    }

    const payload: TableExportPayload = { jobId, tableId, workspaceId, format }
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
        // A failed dispatch must not leave a ghost `running` job behind.
        await releaseJobClaim(tableId, jobId).catch(() => {})
        throw error
      }
    } else {
      runDetached('table-export', () => runTableExport(payload))
    }

    // Audit at authorization (like the streaming route) so an abandoned job
    // still records that the data was requested.
    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_EXPORTED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: access.table.name,
      description: `Exported table "${access.table.name}" as ${format.toUpperCase()}`,
      metadata: { format, rowCount: access.table.rowCount, async: true },
      request,
    })
    captureServerEvent(
      userId,
      'table_exported',
      { table_id: tableId, workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

    logger.info(`[${requestId}] Async export started`, { tableId, jobId, format })

    return v2Data({ tableId, jobId }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error starting async export`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
