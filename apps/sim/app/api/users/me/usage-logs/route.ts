import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getUsageLogsContract } from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs, type UsageLogSource } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('UsageLogsAPI')

const PERIOD_TO_DAYS: Record<'1d' | '7d' | '30d', number> = { '1d': 1, '7d': 7, '30d': 30 }

function resolveStartDate(period: '1d' | '7d' | '30d' | 'all'): Date | undefined {
  if (period === 'all') return undefined
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - PERIOD_TO_DAYS[period])
  return startDate
}

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
  const { source, workspaceId, period, limit, cursor } = parsed.data.query

  const result = await getUserUsageLogs(auth.userId, {
    source: source as UsageLogSource | undefined,
    workspaceId,
    startDate: resolveStartDate(period),
    endDate: new Date(),
    limit,
    cursor,
  })

  const logs = result.logs.map((log) => ({
    id: log.id,
    createdAt: log.createdAt,
    source: log.source,
    description: log.description,
    creditCost: dollarsToCredits(log.cost),
  }))

  const bySourceCredits = Object.fromEntries(
    Object.entries(result.summary.bySource).map(([source, cost]) => [
      source,
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
