import { readOrganizationSearchStatsContract } from '@/lib/api/contracts/knowledge/search-stats'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readOrganizationSearchStats } from '@/lib/knowledge/application/organization-search-stats'

export const GET = defineInternalJsonRoute({
  contract: readOrganizationSearchStatsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readOrganizationSearchStats,
  rateLimit: internalRateLimits.user({
    bucketName: 'organization-search-stats',
    config: { maxTokens: 30, refillRate: 30, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: readOrganizationSearchStats,
  present: (data) => ({ success: true as const, data }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
