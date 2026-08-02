import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ListTableJobsContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkspaceExportJobs } from '@/lib/table/jobs/service'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2TableJobsAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/tables/jobs — Export jobs across a workspace.
 *
 * Export-only today, and `type` is a required literal rather than a default so
 * the parameter can widen to other job kinds later without silently changing
 * what an existing caller receives. Running jobs plus recently finished ones,
 * so a completed export stays re-downloadable. Workspace-scoped, so the
 * permission check is the workspace one.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-jobs')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListTableJobsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const accessError = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (accessError) return v2WorkspaceAccessError(accessError)

    const jobs = await listWorkspaceExportJobs(workspaceId)

    return v2CursorList(jobs, null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing table jobs`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
