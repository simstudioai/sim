import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { listTableJobsContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkspaceExportJobs } from '@/lib/table/jobs/service'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('TableJobsAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/table/jobs?workspaceId=…&type=export
 *
 * Lists a workspace's export jobs (running + recently finished) for the header tray. Exports are
 * excluded from the table-level job derivation, so the tray reads them here.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(listTableJobsContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId } = parsed.data.query

  const { hasAccess } = await checkWorkspaceAccess(workspaceId, authResult.userId)
  if (!hasAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const jobs = await listWorkspaceExportJobs(workspaceId)
  logger.info(`[${requestId}] Listed ${jobs.length} export jobs`, { workspaceId })
  return NextResponse.json({ success: true, data: { jobs } })
})
