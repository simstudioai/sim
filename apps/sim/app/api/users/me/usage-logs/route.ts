import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs, type UsageLogSource } from '@/lib/billing/core/usage-log'
import { apportionCredits, dollarsToCredits } from '@/lib/billing/credits/conversion'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveDateRange, resolveWorkflowNames } from '@/app/api/users/me/usage-logs/shared'

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
  const { source, workspaceId, period, startDate, endDate, limit, cursor } = parsed.data.query

  const dateRange = resolveDateRange(period, startDate, endDate)

  const result = await getUserUsageLogs(auth.userId, {
    source: source as UsageLogSource | undefined,
    workspaceId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit,
    cursor,
  })

  // Apportioned (not independently rounded per row) so this page's visible
  // credit costs always sum to exactly `dollarsToCredits(sum of this page's
  // dollars)` — rounding each row on its own can drift from that sum by
  // several credits over enough rows, which reads as "the numbers don't add
  // up" next to the period total.
  const creditsByLogId = apportionCredits(
    result.logs.map((log) => ({ key: log.id, dollars: log.cost }))
  )

  const workflowNames = await resolveWorkflowNames(result.logs)

  const logs = result.logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    source: log.source,
    workflowName: log.workflowId ? (workflowNames.get(log.workflowId) ?? null) : null,
    creditCost: creditsByLogId[log.id],
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
