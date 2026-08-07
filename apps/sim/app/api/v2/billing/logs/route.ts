import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import { getUsageCreditsByLogId, getUserUsageLogs } from '@/lib/billing/core/usage-log'
import { toBillingUsageLogSource, toInternalUsageLogSources } from '@/lib/billing/usage-sources'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'
import { v2BillingWorkspaceFilter } from '@/app/api/v2/billing/utils'
import { v2CursorList } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Cursor-paged, credit-denominated billing ledger. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListBillingLogsContract,
  rateLimitEndpoint: 'billing-usage',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { source, workspaceId, period, startDate, endDate, limit, cursor } = input.query

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
      runId: log.executionId ?? null,
      creditCost: creditsByLogId[log.id] ?? 0,
    }))

    return v2CursorList(
      items,
      result.pagination.hasMore ? (result.pagination.nextCursor ?? null) : null,
      { rateLimit }
    )
  },
})
