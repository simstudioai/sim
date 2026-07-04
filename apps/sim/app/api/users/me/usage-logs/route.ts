import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  getUsageCreditsByLogId,
  getUserUsageLogs,
  type UsageLogSource,
} from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'

const logger = createLogger('UsageLogsAPI')

/**
 * Lists the authenticated user's credit-consuming usage events (model, tool,
 * and fixed charges), converted to credits for display in Billing settings.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getUsageLogsContract, request, {})
  if (!parsed.success) return parsed.response
  const { source, workspaceId, period, startDate, endDate, limit, cursor, includeCredits } =
    parsed.data.query

  const dateRange = resolveDateRange(period, startDate, endDate)

  const filter = {
    source: source as UsageLogSource | undefined,
    workspaceId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }

  const [result, creditsByLogId] = await Promise.all([
    getUserUsageLogs(auth.userId, { ...filter, limit, cursor }),
    includeCredits
      ? getUsageCreditsByLogId(auth.userId, filter)
      : Promise.resolve<Record<string, number>>({}),
  ])

  const logs = result.logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    source: log.source,
    workflowName: log.workflowName ?? null,
    creditCost: creditsByLogId[log.id] ?? 0,
    dollarCost: log.cost,
  }))

  const bySourceCredits = Object.fromEntries(
    Object.entries(result.summary.bySource).map(([sourceKey, cost]) => [
      sourceKey,
      dollarsToCredits(cost),
    ])
  )

  logger.debug('Retrieved usage logs', {
    userId: auth.userId,
    source,
    period,
    logCount: logs.length,
    hasMore: result.pagination.hasMore,
  })

  return NextResponse.json({
    success: true,
    logs,
    summary: {
      totalCredits: dollarsToCredits(result.summary.totalCost),
      bySourceCredits,
    },
    pagination: result.pagination,
  })
})
