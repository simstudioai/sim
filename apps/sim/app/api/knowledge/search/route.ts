import { internalKnowledgeSearchContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAuthType,
  resolveInternalKnowledgeBillingAttribution,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { prepareKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { finalizeKnowledgeRegistryResponse } from '@/app/api/knowledge/secret-provenance'

export const POST = defineInternalJsonRoute({
  contract: internalKnowledgeSearchContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.search,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Knowledge-search behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.search,
  parseOptions: { maxBodyBytes: 2 * 1024 * 1024 },
  mapInput: ({ body }, { principal, request }) => ({
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
    rerankerApiKey: body.rerankerApiKey,
    skipUsageBilling: body.skipUsageBilling,
    resolveBillingAttribution: (workspaceId: string) =>
      resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
    prepareModelInputProvenance: async ({
      userId,
      workspaceId,
    }: {
      userId: string
      workspaceId: string
    }) => {
      const prepared = await prepareKnowledgeModelInputProvenance({
        headers: request.headers,
        payload: body,
        isInternalRequest: principal.kind === 'delegated',
        userId,
        workspaceId,
        modelInput: body.query,
      })
      if (!prepared.success) throw new OrchestrationError('validation', prepared.error)
      return prepared.registry
    },
  }),
  useCase: searchKnowledge,
  present: (result) => ({
    success: true as const,
    data: {
      results: result.results.map(({ embeddingId: _embeddingId, ...item }) => item),
      query: result.query,
      knowledgeBaseIds: result.knowledgeBaseIds,
      knowledgeBaseId: result.knowledgeBaseId,
      topK: result.topK,
      totalResults: result.totalResults,
      ...(result.cost ? { cost: result.cost } : {}),
    },
  }),
  finalizeResponse: ({ request, principal, result, body }) => {
    if (!result.resultSecretRegistry) {
      throw new Error('Internal Knowledge search did not produce a provenance registry')
    }
    return finalizeKnowledgeRegistryResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      body,
      registry: result.resultSecretRegistry,
    })
  },
})
