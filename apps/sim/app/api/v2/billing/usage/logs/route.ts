import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ListUsageLogsContract } from '@/lib/api/contracts/v2/billing'
import { parseRequest } from '@/lib/api/server'
import {
  getUsageCreditsByLogId,
  getUserUsageLogs,
  type UsageLogSource,
} from '@/lib/billing/core/usage-log'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2BillingUsageLogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/billing/usage/logs — Cursor-paged, credit-denominated ledger of
 * the account's usage events. The per-source aggregate lives on
 * `GET /api/v2/billing/usage`; this is the row-level detail.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'billing-usage')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ListUsageLogsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const { source, workspaceId, period, startDate, endDate, limit, cursor } = parsed.data.query

    const workspaceFilter = v2BillingWorkspaceFilter(rateLimit, workspaceId)
    if (!workspaceFilter.ok) return workspaceFilter.response

    const dateRange = resolveDateRange(period, startDate, endDate)
    const filter = {
      source: source as UsageLogSource | undefined,
      workspaceId: workspaceFilter.workspaceId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }

    const [result, creditsByLogId] = await Promise.all([
      getUserUsageLogs(userId, { ...filter, limit, cursor, includeSummary: false }),
      getUsageCreditsByLogId(userId, filter),
    ])

    const items = result.logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      source: log.source,
      workflowName: log.workflowName ?? null,
      creditCost: creditsByLogId[log.id] ?? 0,
    }))

    return v2CursorList(
      items,
      result.pagination.hasMore ? (result.pagination.nextCursor ?? null) : null,
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error listing usage logs`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
