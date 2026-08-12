import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listBillingLogs } from '@/lib/billing/application/list-billing-logs'
import { billingOperations } from '@/lib/billing/application/operations'
import { toBillingUsageLogSource, toInternalUsageLogSources } from '@/lib/billing/usage-sources'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Cursor-paged, credit-denominated billing ledger. */
export const GET = defineV2JsonRoute({
  contract: v2ListBillingLogsContract,
  auth: v2ApiKeyAuth,
  operation: billingOperations.listLogs,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => {
    const dateRange = resolveDateRange(query.period, query.startDate, query.endDate)
    return {
      source: query.source ? toInternalUsageLogSources(query.source) : undefined,
      workspaceId: query.workspaceId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: query.limit,
      cursor: query.cursor,
    }
  },
  useCase: listBillingLogs,
  present: ({ usage, creditsByLogId }) => ({
    data: usage.logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      source: toBillingUsageLogSource(log.source),
      workspaceId: log.workspaceId ?? null,
      workflow: log.workflowId ? { id: log.workflowId, name: log.workflowName ?? null } : null,
      runId: log.executionId ?? null,
      creditCost: creditsByLogId[log.id] ?? 0,
    })),
    nextCursor: usage.pagination.hasMore ? (usage.pagination.nextCursor ?? null) : null,
  }),
})
