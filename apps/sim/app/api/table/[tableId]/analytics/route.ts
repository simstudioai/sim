import { queryTableAnalyticsContract } from '@/lib/api/contracts/table-analytics'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readTableAnalytics } from '@/lib/table/application/analytics'
import { tableOperations } from '@/lib/table/application/operations'

export const POST = defineInternalJsonRoute({
  contract: queryTableAnalyticsContract,
  auth: internalSessionAuth,
  operation: tableOperations.analytics,
  rateLimit: internalRateLimits.user({
    bucketName: 'table-analytics',
    config: { maxTokens: 120, refillRate: 60, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 64 * 1024 },
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    query: body.query,
  }),
  useCase: readTableAnalytics,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
