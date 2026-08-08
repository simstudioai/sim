import {
  v2DeleteKnowledgeBaseContract,
  v2GetKnowledgeBaseContract,
  v2UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  deleteKnowledgeBaseOperation,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function toV2KnowledgeBase(knowledgeBase: KnowledgeBaseWithCounts, folderPath: string) {
  return {
    id: knowledgeBase.id,
    name: knowledgeBase.name,
    description: knowledgeBase.description,
    tokenCount: knowledgeBase.tokenCount,
    embeddingModel: knowledgeBase.embeddingModel,
    embeddingDimension: knowledgeBase.embeddingDimension,
    chunkingConfig: {
      maxSize: knowledgeBase.chunkingConfig.maxSize,
      minSize: knowledgeBase.chunkingConfig.minSize,
      overlap: knowledgeBase.chunkingConfig.overlap,
      strategy: knowledgeBase.chunkingConfig.strategy,
      strategyOptions: knowledgeBase.chunkingConfig.strategyOptions
        ? {
            pattern: knowledgeBase.chunkingConfig.strategyOptions.pattern,
            separators: knowledgeBase.chunkingConfig.strategyOptions.separators,
            recipe: knowledgeBase.chunkingConfig.strategyOptions.recipe,
            strictBoundaries: knowledgeBase.chunkingConfig.strategyOptions.strictBoundaries,
          }
        : undefined,
    },
    docCount: knowledgeBase.docCount,
    connectorTypes: knowledgeBase.connectorTypes,
    createdAt: knowledgeBase.createdAt.toISOString(),
    updatedAt: knowledgeBase.updatedAt.toISOString(),
    folderPath,
  }
}

const concealKnowledgeBaseReadAuthorization = {
  render(error) {
    const response = v2OrchestrationErrorPolicy.render(error)
    if (response?.status === 403) return v2Error('NOT_FOUND', 'Knowledge base not found')
    return response
  },
} satisfies V2ErrorPolicy

/** GET /api/v2/knowledge/[id] — Get knowledge base details. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: concealKnowledgeBaseReadAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeBase,
  present: ({ knowledgeBase, folderPath }) => ({
    data: { knowledgeBase: toV2KnowledgeBase(knowledgeBase, folderPath) },
  }),
})

/** PUT /api/v2/knowledge/[id] — Update a knowledge base. */
export const PUT = defineV2JsonRoute({
  contract: v2UpdateKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  parseOptions: {
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
  },
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    chunkingConfig: body.chunkingConfig,
    folderPath: body.folderPath,
    source: 'api',
  }),
  useCase: updateKnowledgeBaseOperation,
  present: ({ knowledgeBase, folderPath }) => ({
    data: { knowledgeBase: toV2KnowledgeBase(knowledgeBase, folderPath) },
  }),
})

/** DELETE /api/v2/knowledge/[id] — Delete a knowledge base. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    source: 'api',
  }),
  useCase: deleteKnowledgeBaseOperation,
  onSuccess: ({ result }) => {
    PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: result.id })
  },
  present: ({ id }) => ({ data: { id, deleted: true as const } }),
})
