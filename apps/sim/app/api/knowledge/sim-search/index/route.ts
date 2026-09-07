import { readSearchIndexContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchIndex } from '@/lib/knowledge/application/sim-search'

export const GET = defineInternalJsonRoute({
  contract: readSearchIndexContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readSearchIndex,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.index' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: readSearchIndex,
  present: (data) => ({ success: true, data: { knowledgeBaseId: data.knowledgeBaseId } }),
})
