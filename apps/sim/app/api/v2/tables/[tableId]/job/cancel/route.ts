import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CancelTableJobContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { appendTableEvent } from '@/lib/table/events'
import { getTableJob, markJobCanceled } from '@/lib/table/jobs/service'
import type { TableJobType } from '@/lib/table/types'
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
import { v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableJobCancelAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/job/cancel — Stop an in-flight import or delete.
 *
 * Flips the job's status so the worker's next ownership check fails and it
 * stops. Work already committed (rows inserted or deleted) is left in place —
 * there is no rollback. Idempotent: cancelling a job that already finished
 * reports `canceled: false` rather than failing, so a client racing the
 * worker's completion is not an error.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-jobs')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2CancelTableJobContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, jobId } = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'write')
    if (!access.ok) return v2TableAccessError(access)

    if (access.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    // Resolve the job's real type from its own row — the table-level derivation
    // excludes exports — so the cancel event carries the right `type`.
    const job = await getTableJob(tableId, jobId)
    const type = (job?.type ?? 'import') as TableJobType

    const canceled = await markJobCanceled(tableId, jobId)
    if (canceled) {
      void appendTableEvent({ kind: 'job', type, tableId, jobId, status: 'canceled' })
    }

    logger.info(`[${requestId}] Job cancel requested`, { tableId, jobId, type, canceled })

    return v2Data({ jobId, canceled }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error cancelling table job`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
