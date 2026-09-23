import { v2GetLogStatsContract } from '@/lib/api/contracts/v2/logs-stats'
import { parseUnorderedList } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { getLogStats } from '@/lib/logs/application/get-log-stats'
import { logOperations } from '@/lib/logs/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Bucketed success rate, error count, and latency for a workspace's runs.
 *
 * The aggregate a caller would otherwise have to page every run to compute. Not
 * a list — the response carries no `nextCursor` — so it is bounded instead by
 * the segment ceiling on the request and the workflow ceiling on the response.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetLogStatsContract,
  auth: v2ApiKeyAuth,
  operation: logOperations.readStats,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2LogErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    filters: {
      workflowIds: parseUnorderedList(query.workflowIds),
      triggers: parseUnorderedList(query.triggers),
      level: query.level,
      includeHandledErrors: query.includeHandledErrors,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    },
    folderPaths: parseUnorderedList(query.folderPaths),
    segmentCount: query.segmentCount,
    includeEmpty: query.includeEmpty,
  }),
  useCase: getLogStats,
  present: ({ stats, workflowsTruncated }) => ({ data: { ...stats, workflowsTruncated } }),
})
