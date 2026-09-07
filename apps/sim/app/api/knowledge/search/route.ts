import { searchWorkspaceKnowledgeContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { sourceAuthor } from '@/lib/knowledge/search/author'

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
    surface: 'dashboard' as const,
    signal: request.signal,
  }),
  useCase: searchScopedKnowledge,
  present: ({ results, knowledgeBases }, { input }) => {
    const knowledgeBaseNames = new Map(knowledgeBases.map((kb) => [kb.id, kb.name]))
    return {
      success: true as const,
      data: {
        query: input.query ?? '',
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
