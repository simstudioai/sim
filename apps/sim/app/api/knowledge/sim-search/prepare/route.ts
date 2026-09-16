import { prepareSearchSourceContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'

export const POST = defineInternalJsonRoute({
  contract: prepareSearchSourceContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.prepareSearchSource,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.sources.prepare' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ body }) => body,
  useCase: prepareSearchSource,
  present: (data) => ({ success: true as const, data }),
})
