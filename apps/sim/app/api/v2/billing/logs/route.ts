import { v2ListBillingLogsContract } from '@/lib/api/contracts/v2/billing'
import { cursorRoute, cursorScopeKey, instantScopePart } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2BillingErrorPolicies } from '@/lib/billing/api/route-policies'
import { listBillingLogs } from '@/lib/billing/application/list-billing-logs'
import { billingOperations } from '@/lib/billing/application/operations'
import { toBillingUsageLogSource, toInternalUsageLogSources } from '@/lib/billing/usage-sources'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Every param that changes which ledger entries, in which order, this list
 * returns.
 *
 * The raw params are stamped, not the range `resolveDateRange` derives from
 * them: a relative `period` resolves against the clock, so hashing the resolved
 * window would produce a different stamp on every request and reject each next
 * page. `period=30d` and an explicit custom range covering the same days are
 * therefore two scopes, which is right — one is a moving window.
 *
 * The explicit bounds still bind by instant rather than spelling. That is a
 * pure function of the caller's own text, so it collapses `…00Z` and `…00.000Z`
 * without resolving anything against the clock.
 */
function billingLogCursorFilters(query: {
  source?: string
  workspaceId?: string
  period?: string
  startDate?: string
  endDate?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListBillingLogsContract), {
    source: query.source,
    workspaceId: query.workspaceId,
    period: query.period,
    startDate: instantScopePart(query.startDate),
    endDate: instantScopePart(query.endDate),
  })
}

/** Cursor-paged, credit-denominated billing ledger. */
export const GET = defineV2JsonRoute({
  contract: v2ListBillingLogsContract,
  auth: v2ApiKeyAuth,
  operation: billingOperations.listLogs,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2BillingErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ query }) => {
    const dateRange = resolveDateRange(query.period, query.startDate, query.endDate)
    return {
      source: query.source ? toInternalUsageLogSources(query.source) : undefined,
      workspaceId: query.workspaceId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: query.limit,
      cursor: readScopedCursor(query.cursor, billingLogCursorFilters(query)),
    }
  },
  useCase: listBillingLogs,
  present: ({ usage, creditsByLogId, scope }, { query }) => ({
    scope,
    data: usage.logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      source: toBillingUsageLogSource(log.source),
      workspaceId: log.workspaceId ?? null,
      workflow: log.workflowId ? { id: log.workflowId, name: log.workflowName ?? null } : null,
      runId: log.executionId ?? null,
      creditCost: creditsByLogId[log.id] ?? 0,
    })),
    nextCursor:
      usage.pagination.hasMore && usage.pagination.nextCursor
        ? encodeScopedCursor(billingLogCursorFilters(query), usage.pagination.nextCursor)
        : null,
  }),
})
