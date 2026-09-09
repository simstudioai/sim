import { readSearchSourceOverviewContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'

export const GET = defineInternalJsonRoute({
  contract: readSearchSourceOverviewContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readSearchSourceOverview,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded provider existence probes for source setup and indexing progress',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: readSearchSourceOverview,
  present: (overview) => ({ success: true as const, data: overview }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
