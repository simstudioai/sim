import { searchWorkspaceKnowledgeContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { hasRotatingApiKey } from '@/lib/core/config/api-keys'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { DEFAULT_RERANKER_MODEL } from '@/lib/knowledge/reranker-models'
import { sourceAuthor } from '@/lib/knowledge/search/author'

const DIRECT_SEARCH_VECTOR_BUDGET_MS = 3000

export const POST = defineInternalJsonRoute({
  contract: searchWorkspaceKnowledgeContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.search,
  rateLimit: internalRateLimits.none({
    reason:
      'A person typing queries; the embedding call is metered against the canonical search owner',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.search,
  mapInput: ({ body }, { request }) => ({
    workspaceId: body.workspaceId,
    organizationId: body.organizationId,
    filters: body.filters,
    query: body.query,
    topK: body.topK,
    allowPartialResults: true,
    vectorBudgetMs: DIRECT_SEARCH_VECTOR_BUDGET_MS,
    /**
     * A person's search is reranked by the platform's cross-encoder when one is configured;
     * reranking is best-effort, so a provider outage leaves the fused order in place.
     */
    rerankerEnabled: hasRotatingApiKey('cohere'),
    rerankerModel: DEFAULT_RERANKER_MODEL,
    surface: 'dashboard' as const,
    signal: request.signal,
  }),
  useCase: searchScopedKnowledge,
  present: ({ results, knowledgeBases, retrieval }, { input }) => {
    const knowledgeBaseNames = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]))
    return {
      success: true as const,
      data: {
        query: input.query ?? '',
        retrieval,
        results: results.map((result) => ({
          documentId: result.documentId,
          knowledgeBaseId: result.knowledgeBaseId,
          knowledgeBaseName: knowledgeBaseNames.get(result.knowledgeBaseId) ?? '',
          documentName: result.documentName,
          sourceUrl: result.sourceUrl,
          connectorType: result.connectorType,
          sourceModifiedAt: result.sourceModifiedAt?.toISOString() ?? null,
          author: sourceAuthor(result.metadata),
          content: result.content,
          chunkIndex: result.chunkIndex,
          similarity: result.similarity,
        })),
      },
    }
  },
})
