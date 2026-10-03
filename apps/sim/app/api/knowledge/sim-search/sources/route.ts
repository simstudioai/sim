import { listSearchSourcesContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

export const GET = defineInternalJsonRoute({
  contract: listSearchSourcesContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listSearchSources,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace source summaries for the Search page and indexing status polling',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: listSearchSources,
  present: (page) => ({ success: true as const, data: page }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
