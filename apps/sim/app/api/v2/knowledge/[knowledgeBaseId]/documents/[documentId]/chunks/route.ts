import {
  v2BulkUpdateKnowledgeChunksContract,
  v2CreateKnowledgeChunkContract,
  v2ListKnowledgeChunksContract,
} from '@/lib/api/contracts/v2/knowledge-chunks'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  bulkUpdateKnowledgeChunks,
  createKnowledgeChunk,
  listKnowledgeChunks,
} from '@/lib/knowledge/application/chunks'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeChunk } from '@/app/api/v2/knowledge/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The public surface supplies no secret provenance.
 *
 * A provenance envelope is a trusted in-process trace of which resolved secrets
 * a value was built from, minted by the executor and Copilot. An API caller has
 * no such trace, and accepting one from the wire would let a caller assert
 * provenance the server never observed. `undefined` means "none", which the
 * domain treats as content carrying no secret material — distinct from the
 * `unknown` status it refuses.
 */
const noPublicContentProvenance = () => undefined

/**
 * Every param that changes which chunks, in which order, this list returns.
 *
 * `workspaceId` is not one of them. The sequence is one document, named by the
 * two path params the route already binds; the query's workspace is asserted
 * scope, and any value but the owning workspace is refused by authorization
 * before paging. That is the same reading the structurally identical table-row
 * lists record, and it is declared alongside them in `list-pagination.test.ts`.
 */
function chunkCursorFilters(
  knowledgeBaseId: string,
  documentId: string,
  query: { enabled: string; search?: string }
) {
  return cursorScopeKey(
    cursorRoute(v2ListKnowledgeChunksContract, { knowledgeBaseId, documentId }),
    {
      enabled: query.enabled,
      search: query.search,
    }
  )
}

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks — List a document's chunks.
 *
 * Keyset-paginated. Every sort ends in the chunk id, so a page boundary landing
 * inside a run of equal `tokenCount` or `enabled` values cannot repeat or drop
 * the tied rows. A document still processing answers 409, not an empty page.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeChunksContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listChunks,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
    search: query.search,
    enabled: query.enabled,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      chunkCursorFilters(params.knowledgeBaseId, params.documentId, query)
    ),
  }),
  useCase: listKnowledgeChunks,
  present: ({ chunks, nextCursorKeys }, { params, query }) => ({
    data: chunks.map(toV2KnowledgeChunk),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      chunkCursorFilters(params.knowledgeBaseId, params.documentId, query)
    ),
  }),
})

/**
 * POST /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks — Append a chunk.
 *
 * The chunk is embedded before the response returns, so it is searchable
 * immediately. Chunks on a connector-synced document are read-only.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeChunkContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.createChunk,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: body.workspaceId,
    content: body.content,
    enabled: body.enabled,
    resolveContentProvenance: noPublicContentProvenance,
  }),
  useCase: createKnowledgeChunk,
  present: ({ chunk }) => ({ data: toV2KnowledgeChunk(chunk) }),
})

/**
 * PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks — Enable, disable,
 * or delete many chunks at once.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2BulkUpdateKnowledgeChunksContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.bulkChunks,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeChunkAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: body.workspaceId,
    operation: body.operation,
    chunkIds: body.chunkIds,
  }),
  useCase: bulkUpdateKnowledgeChunks,
  present: ({ operation, processed, errors }) => ({
    data: { operation, processed, errors },
  }),
})
