import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ExportDownloadContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getTableJob } from '@/lib/table/jobs/service'
import type { TableExportJobPayload } from '@/lib/table/types'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
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

const logger = createLogger('V2TableExportDownloadAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * GET /api/v2/tables/[tableId]/export/download — Presigned URL for a finished
 * export.
 *
 * The three failure modes are deliberately distinct: a job that isn't an export
 * of this table is 404, one still running is 409 (retry later), and one whose
 * generated file has aged out of storage is 410 (start a new export) — a caller
 * polling to completion needs to tell "not yet" from "never again".
 */
export const GET = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-export')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2ExportDownloadContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, jobId } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!access.ok || access.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const job = await getTableJob(tableId, jobId)
    if (!job || job.type !== 'export') return v2Error('NOT_FOUND', 'Export job not found')
    if (job.status !== 'ready') return v2Error('CONFLICT', 'Export is not ready')

    const payload = job.payload as TableExportJobPayload | null
    if (!payload?.resultKey) {
      return v2Error('NOT_FOUND', 'Export file is no longer available', { status: 410 })
    }

    const url = await generatePresignedDownloadUrl(payload.resultKey, 'workspace')
    const fileName = payload.resultKey.split('/').pop() ?? `export.${payload.format}`

    logger.info(`[${requestId}] Export download URL issued`, { tableId, jobId })

    return v2Data({ url, fileName }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error issuing export download URL`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
