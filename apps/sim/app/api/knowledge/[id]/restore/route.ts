import { restoreKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { restoreInternalKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeSessionOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: restoreKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeSessionOperations.restore,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base restore behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.restore,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: restoreInternalKnowledgeBase,
  present: internalJsonPresenters.successFrom('success'),
})
