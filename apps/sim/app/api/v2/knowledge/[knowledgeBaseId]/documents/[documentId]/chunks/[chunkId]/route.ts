import {
  v2DeleteKnowledgeChunkContract,
  v2GetKnowledgeChunkContract,
  v2UpdateKnowledgeChunkContract,
} from '@/lib/api/contracts/v2/knowledge-chunks'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeChunk,
  readKnowledgeChunk,
  updateKnowledgeChunk,
} from '@/lib/knowledge/application/chunks'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeChunk } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The public surface supplies no secret provenance — see the sibling collection
 * route for why an API caller cannot assert one.
 */
const noPublicContentProvenance = () => undefined

/** GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId] — Read one chunk. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeChunkContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readChunk,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    chunkId: params.chunkId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeChunk,
  present: ({ chunk }) => ({ data: toV2KnowledgeChunk(chunk) }),
})

/**
 * PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId] — Edit a chunk.
 *
 * Changing `content` re-embeds the chunk and re-derives the document's token
 * and character counts, so the correction is reflected in search immediately.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeChunkContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateChunk,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    chunkId: params.chunkId,
    assertedWorkspaceId: body.workspaceId,
    content: body.content,
    enabled: body.enabled,
    resolveContentProvenance: noPublicContentProvenance,
  }),
  useCase: updateKnowledgeChunk,
  present: ({ chunk }) => ({ data: toV2KnowledgeChunk(chunk) }),
})

/** DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId] — Remove a chunk. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeChunkContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteChunk,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    chunkId: params.chunkId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: deleteKnowledgeChunk,
  present: (_result, { params }) => ({ data: { id: params.chunkId, deleted: true as const } }),
})
