import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { exportDownloadContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { capabilityGovernedAuthUserId, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { getTableJob } from '@/lib/table/jobs/service'
import type { TableExportJobPayload } from '@/lib/table/types'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableExportDownload')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * GET /api/table/[tableId]/export/download?jobId=…
 *
 * Resolves a completed export job to a short-lived presigned URL for the generated file. The job
 * must belong to the table, be an export, and be `ready` — the worker stamps `resultKey` onto the
 * job payload when the upload lands.
 */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(exportDownloadContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, jobId } = parsed.data.query

  const access = await checkAccess(tableId, { kind: 'user', userId: authResult.userId }, 'read')
  if (!access.ok) return accessError(access, requestId, tableId)
  if (access.table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }

  /**
   * permission-group-enforced: tables.export — the second door to a finished
   * export. Gating only the job that produces one leaves this route handing the
   * file to anyone who can name a `jobId`, and the workspace job listing names
   * every colleague's.
   *
   * Keyed to the governed subject, which names nobody for an internal-JWT
   * executor call, exactly as the listing and the job that produced this file
   * are: `authResult.userId` there is the subject the executor embedded, so
   * reading it bare would apply the run's actor's group to a delegation the
   * executor exemption deliberately passes ungated — and would refuse the
   * download of an export the same run was allowed to start.
   */
  const governedUserId = capabilityGovernedAuthUserId(authResult)
  if (
    governedUserId &&
    (await isWorkspaceCapabilityWithheld(governedUserId, workspaceId, 'tables.export'))
  ) {
    return capabilityRefusalResponse('tables.export')
  }

  const job = await getTableJob(tableId, jobId)
  if (!job || job.type !== 'export') {
    return NextResponse.json({ error: 'Export job not found' }, { status: 404 })
  }
  if (job.status !== 'ready') {
    return NextResponse.json({ error: 'Export is not ready' }, { status: 409 })
  }
  const payload = job.payload as TableExportJobPayload | null
  if (!payload?.resultKey) {
    return NextResponse.json({ error: 'Export file is no longer available' }, { status: 410 })
  }

  const url = await generatePresignedDownloadUrl(payload.resultKey, 'workspace')
  const fileName = payload.resultKey.split('/').pop() ?? `export.${payload.format}`
  logger.info(`[${requestId}] Export download URL issued`, { tableId, jobId })
  return NextResponse.json({ success: true, data: { url, fileName } })
})
