import { v2SearchKnowledgeContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/knowledge/search — Vector / tag search across knowledge bases. */
export const POST = defineV2JsonRoute({
  contract: v2SearchKnowledgeContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.search,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.usage,
  parseOptions: {
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
  },
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds)
      ? body.knowledgeBaseIds
      : [body.knowledgeBaseIds],
    query: body.query,
    topK: body.topK,
    tagFilters: body.tagFilters,
    searchMode: body.searchMode,
  }),
  useCase: searchKnowledge,
  present: (result) => ({ data: result }),
})
