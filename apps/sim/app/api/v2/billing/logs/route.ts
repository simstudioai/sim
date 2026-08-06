import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import { parseRequest } from '@/lib/api/server'
import { getUsageCreditsByLogId, getUserUsageLogs } from '@/lib/billing/core/usage-log'
import { toBillingUsageLogSource, toInternalUsageLogSources } from '@/lib/billing/usage-sources'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2BillingLogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Cursor-paged, credit-denominated billing ledger. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'billing-usage')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListBillingLogsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const { source, workspaceId, period, startDate, endDate, limit, cursor } = parsed.data.query

    const workspaceFilter = await v2BillingWorkspaceFilter(rateLimit, workspaceId)
    if (!workspaceFilter.ok) return workspaceFilter.response

    const dateRange = resolveDateRange(period, startDate, endDate)
    const filter = {
      source: source ? toInternalUsageLogSources(source) : undefined,
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
      source: toBillingUsageLogSource(log.source),
      workspaceId: log.workspaceId ?? null,
      workflow: log.workflowId ? { id: log.workflowId, name: log.workflowName ?? null } : null,
      executionId: log.executionId ?? null,
      creditCost: creditsByLogId[log.id] ?? 0,
    }))

    return v2CursorList(
      items,
      result.pagination.hasMore ? (result.pagination.nextCursor ?? null) : null,
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error listing billing logs`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
