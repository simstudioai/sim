import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getEnrichmentDetailContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadEnrichmentDetail } from '@/lib/table/rows/executions'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('EnrichmentDetailAPI')

interface RouteParams {
  params: Promise<{ tableId: string; rowId: string; groupId: string }>
}

/**
 * GET /api/table/[tableId]/rows/[rowId]/enrichment/[groupId]
 *
 * Returns the enrichment cascade breakdown (provider outcomes, cost, timing)
 * for one enrichment cell. Read on demand by the enrichment details panel —
 * this data is deliberately kept off the hot grid read. Returns `null` for
 * cells with no recorded run or runs that predate the feature.
 */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(getEnrichmentDetailContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId, rowId, groupId } = parsed.data.params

  const result = await checkAccess(tableId, authResult.userId, 'read')
  if (!result.ok) return accessError(result, requestId, tableId)

  const detail = await loadEnrichmentDetail(db, tableId, rowId, groupId)

  logger.info(`[${requestId}] Loaded enrichment detail`, {
    tableId,
    rowId,
    groupId,
    hasDetail: detail !== null,
  })

  return NextResponse.json({ success: true, data: { detail } })
})
