import {
  v2BulkUpdateKnowledgeChunksContract,
  v2CreateKnowledgeChunkContract,
  v2DeleteKnowledgeChunkContract,
  v2GetKnowledgeChunkContract,
  v2ListKnowledgeChunksContract,
  v2UpdateKnowledgeChunkContract,
} from '@/lib/api/contracts/v2/knowledge-chunks'
import {
  KNOWLEDGE_WORKSPACE_ID,
  knowledgeOperation,
} from '@/lib/api/contracts/v2/openapi/knowledge-shared'
import {
  documentedSchema,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

/**
 * Chunk operations of the knowledge OpenAPI document.
 *
 * Every one of them publishes `409` rather than only the resource set: a chunk
 * is only addressable once its document has finished processing, and a document
 * still pending, processing, or failed refuses the request on state rather than
 * on the request itself.
 */

const DOCUMENT_NOT_READY =
  'Documents that have not finished processing return `409` with their current status.'
const CONNECTOR_MANAGED =
  'Connector-synced chunks are read-only and return `403` with `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`; change the source and re-sync, or exclude the document.'

export const knowledgeChunkOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListKnowledgeChunksContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.listChunks,
      operationId: 'listKnowledgeChunks',
      summary: 'List Chunks',
      description: `List document chunks with content search, enabled filtering, sorting, and cursor pagination. Tags use slots; use List Tags to resolve display names. ${DOCUMENT_NOT_READY} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'A page of document chunks.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeChunksContract.params,
        'ListKnowledgeChunksParams',
        'List knowledge chunks path parameters',
        'Knowledge base and document whose chunks should be listed.'
      ),
      query: documentedSchema(
        v2ListKnowledgeChunksContract.query,
        'ListKnowledgeChunksQuery',
        'List knowledge chunks query',
        'Workspace, search, enabled filtering, sorting, and pagination options.'
      ),
      response: documentedSchema(
        v2ListKnowledgeChunksContract.response.schema,
        'V2KnowledgeChunkListResponse',
        'Knowledge chunk list response',
        'A cursor-paginated page of document chunks.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeChunkContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.createChunk,
      operationId: 'createKnowledgeChunk',
      summary: 'Create Chunk',
      description: `Append a chunk, embedding it before the response so it is immediately searchable. It inherits the document's tags and next \`chunkIndex\`. ${CONNECTOR_MANAGED} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The created chunk.' },
    }),
    {
      query: v2CreateKnowledgeChunkContract.query,
      params: documentedSchema(
        v2CreateKnowledgeChunkContract.params,
        'CreateKnowledgeChunkParams',
        'Create knowledge chunk path parameters',
        'Knowledge base and document the chunk is appended to.'
      ),
      body: documentedSchema(
        v2CreateKnowledgeChunkContract.body,
        'CreateKnowledgeChunkRequest',
        'Create knowledge chunk request',
        'Workspace scope and the text to embed.',
        [
          {
            workspaceId: KNOWLEDGE_WORKSPACE_ID,
            content: 'To reset your password, open Settings and choose Security.',
          },
        ]
      ),
      response: documentedSchema(
        v2CreateKnowledgeChunkContract.response.schema,
        'V2KnowledgeChunkResponse',
        'Knowledge chunk response',
        'A single document chunk.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkUpdateKnowledgeChunksContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.bulkChunks,
      operationId: 'bulkUpdateKnowledgeChunks',
      summary: 'Bulk Update Chunks',
      description: `Enable, disable, or delete multiple chunks in one best-effort request. Unknown chunk IDs appear in \`errors\` without failing the request; \`processed\` counts matched chunks, not changes. ${CONNECTOR_MANAGED} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'Outcome of the bulk chunk operation.' },
    }),
    {
      query: v2BulkUpdateKnowledgeChunksContract.query,
      params: documentedSchema(
        v2BulkUpdateKnowledgeChunksContract.params,
        'BulkUpdateKnowledgeChunksParams',
        'Bulk knowledge chunk path parameters',
        'Knowledge base and document whose chunks are updated.'
      ),
      body: documentedSchema(
        v2BulkUpdateKnowledgeChunksContract.body,
        'BulkUpdateKnowledgeChunksRequest',
        'Bulk knowledge chunk request',
        'Workspace scope, the operation to apply, and the chunks to apply it to.',
        [
          {
            workspaceId: KNOWLEDGE_WORKSPACE_ID,
            operation: 'disable',
            chunkIds: ['4c1f9e77-2b3a-4f8d-9e10-6a2c8d4b1e05'],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkUpdateKnowledgeChunksContract.response.schema,
        'V2BulkKnowledgeChunksResponse',
        'Bulk knowledge chunk response',
        'Counts and per-chunk failures from a bulk chunk operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetKnowledgeChunkContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.readChunk,
      operationId: 'getKnowledgeChunk',
      summary: 'Get Chunk',
      description: `Get one chunk of a document, including the exact text that was embedded. ${DOCUMENT_NOT_READY} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The requested chunk.' },
    }),
    {
      params: documentedSchema(
        v2GetKnowledgeChunkContract.params,
        'GetKnowledgeChunkParams',
        'Get knowledge chunk path parameters',
        'Knowledge base, document, and chunk selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetKnowledgeChunkContract.query,
        'GetKnowledgeChunkQuery',
        'Get knowledge chunk query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2GetKnowledgeChunkContract.response.schema,
        'V2KnowledgeChunkResponse',
        'Knowledge chunk response',
        'A single document chunk.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateKnowledgeChunkContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.updateChunk,
      operationId: 'updateKnowledgeChunk',
      summary: 'Update Chunk',
      description: `Correct chunk text or disable it from search. Changing \`content\` re-embeds immediately and recalculates document token and character counts; disabling retains the index. ${CONNECTOR_MANAGED} ${DOCUMENT_NOT_READY} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated chunk.' },
    }),
    {
      query: v2UpdateKnowledgeChunkContract.query,
      params: documentedSchema(
        v2UpdateKnowledgeChunkContract.params,
        'UpdateKnowledgeChunkParams',
        'Update knowledge chunk path parameters',
        'Knowledge base, document, and chunk selected for update.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeChunkContract.body,
        'UpdateKnowledgeChunkRequest',
        'Update knowledge chunk request',
        'Workspace scope and the fields to update. At least one is required.',
        [{ workspaceId: KNOWLEDGE_WORKSPACE_ID, enabled: false }]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeChunkContract.response.schema,
        'V2KnowledgeChunkResponse',
        'Knowledge chunk response',
        'A single document chunk.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeChunkContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.deleteChunk,
      operationId: 'deleteKnowledgeChunk',
      summary: 'Delete Chunk',
      description: `Permanently remove one chunk and subtract it from document counts. Remaining \`chunkIndex\` values stay stable and may become non-contiguous. ${CONNECTOR_MANAGED} ${DOCUMENT_NOT_READY} ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Chunk deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeChunkContract.params,
        'DeleteKnowledgeChunkParams',
        'Delete knowledge chunk path parameters',
        'Knowledge base, document, and chunk selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeChunkContract.query,
        'DeleteKnowledgeChunkQuery',
        'Delete knowledge chunk query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeChunkContract.response.schema,
        'V2KnowledgeDeleteResponse',
        'Knowledge deletion response',
        'Deletion acknowledgement containing the removed resource identifier.'
      ),
    }
  ),
] as const
