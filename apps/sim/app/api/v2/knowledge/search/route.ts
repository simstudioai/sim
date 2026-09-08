import { v2SearchKnowledgeContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Keeps public Knowledge search request materialization bounded to 2 MiB. */
export const V2_KNOWLEDGE_SEARCH_MAX_BODY_BYTES = 2 * 1024 * 1024

/** POST /api/v2/knowledge/search — Vector / tag search across knowledge bases. */
export const POST = defineV2JsonRoute({
  contract: v2SearchKnowledgeContract,
  auth: v2ApiKeyAuth,
  /** Search is resource-read-only even though metering writes a usage record. */
  operation: knowledgeOperations.search,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUsageAuthorization,
  parseOptions: {
    maxBodyBytes: V2_KNOWLEDGE_SEARCH_MAX_BODY_BYTES,
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
    rerankerEnabled: body.rerankerEnabled,
    rerankerModel: body.rerankerModel,
    rerankerInputCount: body.rerankerInputCount,
  }),
  useCase: searchKnowledge,
  /**
   * Projected field by field rather than spread. The use-case result also
   * carries `userId`, `workspaceId`, a `cost` breakdown with pricing internals,
   * and a live resolved-secret trace registry; only Zod's default key-stripping
   * keeps them off the wire today, so a single loosened or opaque field in the
   * response schema would ship them.
   */
  present: (result) => ({
    data: {
      results: result.results,
      query: result.query,
      knowledgeBaseIds: result.knowledgeBaseIds,
      topK: result.topK,
      totalResults: result.totalResults,
      rerankerStatus: result.rerankerStatus,
    },
  }),
})
