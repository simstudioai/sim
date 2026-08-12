import {
  v2AbortKnowledgeDocumentUploadContract,
  v2CompleteKnowledgeDocumentUploadContract,
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadPartUrlsContract,
  v2CreateKnowledgeFolderContract,
  v2DeleteKnowledgeBaseContract,
  v2DeleteKnowledgeDocumentContract,
  v2DeleteKnowledgeFolderContract,
  v2GetKnowledgeBaseContract,
  v2GetKnowledgeDocumentContract,
  v2ListKnowledgeBasesContract,
  v2ListKnowledgeDocumentsContract,
  v2ListKnowledgeFoldersContract,
  v2RelocateKnowledgeFolderContract,
  v2SearchKnowledgeContract,
  v2UpdateKnowledgeBaseContract,
  v2UploadKnowledgeDocumentContract,
  v2UploadKnowledgeDocumentFormSchema,
} from '@/lib/api/contracts/v2/knowledge'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  VALIDATED_ERRORS,
  WORKSPACE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiSuccessMetadata,
} from '@/lib/api/openapi/types'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const KNOWLEDGE_BASE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

function knowledgeOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Knowledge Bases'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}

const routes = [
  defineOpenApiRoute(
    v2ListKnowledgeBasesContract,
    knowledgeOperation({
      operationId: 'listKnowledgeBases',
      summary: 'List Knowledge Bases',
      description: `List knowledge bases in a workspace with folder filtering, search, sorting, and the canonical cursor envelope. The bounded workspace set is returned in one page with \`nextCursor\` always null; there is no second page to fetch. An unknown \`folderPath\` is a 404. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of knowledge bases.' },
    }),
    {
      query: documentedSchema(
        v2ListKnowledgeBasesContract.query,
        'ListKnowledgeBasesQuery',
        'List knowledge bases query',
        'Workspace, folder, search, and sorting options for listing knowledge bases.'
      ),
      response: documentedSchema(
        v2ListKnowledgeBasesContract.response.schema,
        'V2KnowledgeBaseListResponse',
        'Knowledge base list response',
        'A cursor-paginated page of knowledge bases.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeBaseContract,
    knowledgeOperation({
      operationId: 'createKnowledgeBase',
      summary: 'Create Knowledge Base',
      description: `Create a knowledge base in a workspace with optional folder placement and chunking configuration. An unknown \`folderPath\` is a 404. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created knowledge base.' },
    }),
    {
      body: documentedSchema(
        v2CreateKnowledgeBaseContract.body,
        'CreateKnowledgeBaseRequest',
        'Create knowledge base request',
        'Workspace, name, description, chunking configuration, and folder placement.',
        [{ workspaceId: WORKSPACE_ID, name: 'Product Documentation', folderPath: '/Product' }]
      ),
      response: documentedSchema(
        v2CreateKnowledgeBaseContract.response.schema,
        'V2KnowledgeBaseResponse',
        'Knowledge base response',
        'A single knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetKnowledgeBaseContract,
    knowledgeOperation({
      operationId: 'getKnowledgeBase',
      summary: 'Get Knowledge Base',
      description: `Retrieve a knowledge base by identifier. Inaccessible knowledge bases are reported as not found. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...VALIDATED_ERRORS, 'NotFound', 'PayloadTooLarge'],
      success: { description: 'The requested knowledge base.' },
    }),
    {
      params: documentedSchema(
        v2GetKnowledgeBaseContract.params,
        'GetKnowledgeBaseParams',
        'Get knowledge base path parameters',
        'Knowledge base selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetKnowledgeBaseContract.query,
        'GetKnowledgeBaseQuery',
        'Get knowledge base query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2GetKnowledgeBaseContract.response.schema,
        'V2KnowledgeBaseResponse',
        'Knowledge base response',
        'A single knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateKnowledgeBaseContract,
    knowledgeOperation({
      operationId: 'updateKnowledgeBase',
      summary: 'Update Knowledge Base',
      description: `Update a knowledge base name, description, chunking configuration, or folder placement. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The updated knowledge base.' },
    }),
    {
      params: documentedSchema(
        v2UpdateKnowledgeBaseContract.params,
        'UpdateKnowledgeBaseParams',
        'Update knowledge base path parameters',
        'Knowledge base selected for update.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeBaseContract.body,
        'UpdateKnowledgeBaseRequest',
        'Update knowledge base request',
        'Workspace scope and fields to update. At least one mutable field is required.',
        [{ workspaceId: WORKSPACE_ID, name: 'Updated Product Documentation' }]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeBaseContract.response.schema,
        'V2KnowledgeBaseResponse',
        'Knowledge base response',
        'A single knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeBaseContract,
    knowledgeOperation({
      operationId: 'deleteKnowledgeBase',
      summary: 'Delete Knowledge Base',
      description: 'Delete a knowledge base and its documents.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: { description: 'Knowledge base deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeBaseContract.params,
        'DeleteKnowledgeBaseParams',
        'Delete knowledge base path parameters',
        'Knowledge base selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeBaseContract.query,
        'DeleteKnowledgeBaseQuery',
        'Delete knowledge base query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeBaseContract.response.schema,
        'V2KnowledgeDeleteResponse',
        'Knowledge deletion response',
        'Deletion acknowledgement containing the removed resource identifier.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SearchKnowledgeContract,
    knowledgeOperation({
      operationId: 'searchKnowledge',
      summary: 'Search Knowledge',
      description:
        'Search one or more knowledge bases with semantic vector retrieval, optional hybrid full-text retrieval, and structured tag filters. The request body is capped at 2 MiB; a larger body is a 413.',
      errors: [...WORKSPACE_ERRORS, 'UsageLimitExceeded', 'NotFound', 'PayloadTooLarge'],
      success: { description: 'Matching document chunks ordered by relevance.' },
    }),
    {
      body: documentedSchema(
        v2SearchKnowledgeContract.body,
        'SearchKnowledgeRequest',
        'Search knowledge request',
        'Knowledge bases, query, result limit, retrieval mode, and optional tag filters.',
        [
          {
            workspaceId: WORKSPACE_ID,
            knowledgeBaseIds: [KNOWLEDGE_BASE_ID],
            query: 'How do I reset my password?',
            topK: 10,
          },
        ]
      ),
      response: documentedSchema(
        v2SearchKnowledgeContract.response.schema,
        'V2KnowledgeSearchResponse',
        'Knowledge search response',
        'Matching chunks and search execution context.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListKnowledgeDocumentsContract,
    knowledgeOperation({
      operationId: 'listKnowledgeDocuments',
      summary: 'List Documents',
      description:
        'List documents in a knowledge base with filename search, state filtering, sorting, and opaque cursor pagination.',
      errors: [...VALIDATED_ERRORS, 'NotFound'],
      success: { description: 'A page of knowledge documents.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeDocumentsContract.params,
        'ListKnowledgeDocumentsParams',
        'List knowledge documents path parameters',
        'Knowledge base whose documents should be listed.'
      ),
      query: documentedSchema(
        v2ListKnowledgeDocumentsContract.query,
        'ListKnowledgeDocumentsQuery',
        'List knowledge documents query',
        'Workspace, pagination, filtering, search, and sorting options.'
      ),
      response: documentedSchema(
        v2ListKnowledgeDocumentsContract.response.schema,
        'V2KnowledgeDocumentListResponse',
        'Knowledge document list response',
        'A cursor-paginated page of knowledge documents.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UploadKnowledgeDocumentContract,
    knowledgeOperation({
      operationId: 'uploadKnowledgeDocument',
      summary: 'Upload Document',
      description:
        'Upload one document as multipart form data. Processing continues asynchronously after the document is accepted.',
      errors: [
        ...WORKSPACE_ERRORS,
        'UsageLimitExceeded',
        'NotFound',
        'PayloadTooLarge',
        'UnsupportedMediaType',
      ],
      success: { description: 'The accepted document queued for processing.' },
    }),
    {
      params: documentedSchema(
        v2UploadKnowledgeDocumentContract.params,
        'UploadKnowledgeDocumentParams',
        'Upload knowledge document path parameters',
        'Knowledge base that will own the document.'
      ),
      query: documentedSchema(
        v2UploadKnowledgeDocumentContract.query,
        'UploadKnowledgeDocumentQuery',
        'Upload knowledge document query',
        'Workspace scope checked before the multipart body is buffered.'
      ),
      requestBody: {
        schema: documentedSchema(
          v2UploadKnowledgeDocumentFormSchema,
          'UploadKnowledgeDocumentForm',
          'Upload knowledge document form',
          'Multipart form containing the document file.'
        ),
        contentTypes: ['multipart/form-data'],
      },
      response: documentedSchema(
        v2UploadKnowledgeDocumentContract.response.schema,
        'V2KnowledgeDocumentSummaryResponse',
        'Knowledge document summary response',
        'An accepted knowledge document summary.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeDocumentUploadContract,
    knowledgeOperation({
      operationId: 'createKnowledgeDocumentUpload',
      summary: 'Create Document Upload',
      description:
        'Create a resumable upload session and receive direct PUT or multipart transfer instructions.',
      errors: [
        ...WORKSPACE_ERRORS,
        'UsageLimitExceeded',
        'NotFound',
        'PayloadTooLarge',
        'UnsupportedMediaType',
      ],
      success: { description: 'The created upload session and transfer instructions.' },
    }),
    {
      params: documentedSchema(
        v2CreateKnowledgeDocumentUploadContract.params,
        'CreateKnowledgeDocumentUploadParams',
        'Create knowledge document upload path parameters',
        'Knowledge base that will own the document.'
      ),
      body: documentedSchema(
        v2CreateKnowledgeDocumentUploadContract.body,
        'CreateKnowledgeDocumentUploadRequest',
        'Create knowledge document upload request',
        'Document metadata used to authorize and initialize the upload.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: 'getting-started.pdf',
            contentType: 'application/pdf',
            size: 248913,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateKnowledgeDocumentUploadContract.response.schema,
        'V2CreateKnowledgeDocumentUploadResponse',
        'Create knowledge document upload response',
        'Upload session, signed control token, and transfer instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AbortKnowledgeDocumentUploadContract,
    knowledgeOperation({
      operationId: 'abortKnowledgeDocumentUpload',
      summary: 'Abort Document Upload',
      description: 'Abort an incomplete upload and discard provider-side multipart state.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'The aborted upload session.' },
    }),
    {
      params: documentedSchema(
        v2AbortKnowledgeDocumentUploadContract.params,
        'AbortKnowledgeDocumentUploadParams',
        'Abort knowledge document upload path parameters',
        'Knowledge base and upload session selected for abortion.'
      ),
      query: documentedSchema(
        v2AbortKnowledgeDocumentUploadContract.query,
        'AbortKnowledgeDocumentUploadQuery',
        'Abort knowledge document upload query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2AbortKnowledgeDocumentUploadContract.headers,
        'AbortKnowledgeDocumentUploadHeaders',
        'Abort knowledge document upload headers',
        'Signed upload control token.'
      ),
      response: documentedSchema(
        v2AbortKnowledgeDocumentUploadContract.response.schema,
        'V2KnowledgeDocumentUploadResponse',
        'Knowledge document upload response',
        'Current state of a knowledge document upload session.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeDocumentUploadPartUrlsContract,
    knowledgeOperation({
      operationId: 'createKnowledgeDocumentUploadPartUrls',
      summary: 'Create Document Upload Part URLs',
      description: 'Issue short-lived signed PUT URLs for up to 100 multipart part numbers.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
      success: { description: 'Signed URLs for the requested upload parts.' },
    }),
    {
      params: documentedSchema(
        v2CreateKnowledgeDocumentUploadPartUrlsContract.params,
        'CreateKnowledgeDocumentUploadPartUrlsParams',
        'Create upload part URLs path parameters',
        'Knowledge base and upload session selected for multipart transfer.'
      ),
      query: documentedSchema(
        v2CreateKnowledgeDocumentUploadPartUrlsContract.query,
        'CreateKnowledgeDocumentUploadPartUrlsQuery',
        'Create upload part URLs query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2CreateKnowledgeDocumentUploadPartUrlsContract.headers,
        'CreateKnowledgeDocumentUploadPartUrlsHeaders',
        'Create upload part URLs headers',
        'Signed upload control token.'
      ),
      body: documentedSchema(
        v2CreateKnowledgeDocumentUploadPartUrlsContract.body,
        'CreateKnowledgeDocumentUploadPartUrlsRequest',
        'Create upload part URLs request',
        'Multipart part numbers for which signed URLs should be created.',
        [{ partNumbers: [1, 2, 3] }]
      ),
      response: documentedSchema(
        v2CreateKnowledgeDocumentUploadPartUrlsContract.response.schema,
        'V2KnowledgeDocumentUploadPartUrlsResponse',
        'Knowledge document upload part URLs response',
        'Signed provider URLs for requested multipart parts.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CompleteKnowledgeDocumentUploadContract,
    knowledgeOperation({
      operationId: 'completeKnowledgeDocumentUpload',
      summary: 'Complete Document Upload',
      description:
        'Verify a direct upload or assemble multipart parts, create the knowledge document, and queue asynchronous processing.',
      errors: [...WORKSPACE_ERRORS, 'UsageLimitExceeded', 'NotFound', 'Conflict'],
      success: { description: 'The completed upload and queued document.' },
    }),
    {
      params: documentedSchema(
        v2CompleteKnowledgeDocumentUploadContract.params,
        'CompleteKnowledgeDocumentUploadParams',
        'Complete knowledge document upload path parameters',
        'Knowledge base and upload session selected for completion.'
      ),
      query: documentedSchema(
        v2CompleteKnowledgeDocumentUploadContract.query,
        'CompleteKnowledgeDocumentUploadQuery',
        'Complete knowledge document upload query',
        'Workspace scope for the upload session.'
      ),
      headers: documentedSchema(
        v2CompleteKnowledgeDocumentUploadContract.headers,
        'CompleteKnowledgeDocumentUploadHeaders',
        'Complete knowledge document upload headers',
        'Signed upload control token.'
      ),
      response: documentedSchema(
        v2CompleteKnowledgeDocumentUploadContract.response.schema,
        'V2KnowledgeDocumentUploadResponse',
        'Knowledge document upload response',
        'Current state of a knowledge document upload session.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetKnowledgeDocumentContract,
    knowledgeOperation({
      operationId: 'getKnowledgeDocument',
      summary: 'Get Document',
      description: 'Retrieve document detail, processing state, and connector provenance.',
      errors: [...VALIDATED_ERRORS, 'NotFound'],
      success: { description: 'The requested knowledge document.' },
    }),
    {
      params: documentedSchema(
        v2GetKnowledgeDocumentContract.params,
        'GetKnowledgeDocumentParams',
        'Get knowledge document path parameters',
        'Knowledge base and document selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetKnowledgeDocumentContract.query,
        'GetKnowledgeDocumentQuery',
        'Get knowledge document query',
        'Workspace scope for the knowledge document.'
      ),
      response: documentedSchema(
        v2GetKnowledgeDocumentContract.response.schema,
        'V2KnowledgeDocumentResponse',
        'Knowledge document response',
        'Full knowledge document detail.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeDocumentContract,
    knowledgeOperation({
      operationId: 'deleteKnowledgeDocument',
      summary: 'Delete Document',
      description:
        'Remove one document from a knowledge base. What that means depends on the document. A directly uploaded document is deleted outright along with its indexed chunks. A connector-backed document is instead excluded: its row survives, marked excluded and disabled so it stops being searchable and a later connector sync does not re-add it, and its embeddings are not deleted. Either way the document no longer appears in listings or search results.',
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: { description: 'Knowledge document deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeDocumentContract.params,
        'DeleteKnowledgeDocumentParams',
        'Delete knowledge document path parameters',
        'Knowledge base and document selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeDocumentContract.query,
        'DeleteKnowledgeDocumentQuery',
        'Delete knowledge document query',
        'Workspace scope for the knowledge document.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeDocumentContract.response.schema,
        'V2KnowledgeDeleteResponse',
        'Knowledge deletion response',
        'Deletion acknowledgement containing the removed resource identifier.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListKnowledgeFoldersContract,
    knowledgeOperation({
      operationId: 'listKnowledgeFolders',
      summary: 'List Folders',
      description: `List folders in the knowledge-base folder tree with filtering and sorting. The bounded set is returned in one page with \`nextCursor\` always null; there is no second page to fetch. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of knowledge-base folders.' },
    }),
    {
      query: documentedSchema(
        v2ListKnowledgeFoldersContract.query,
        'ListKnowledgeFoldersQuery',
        'List knowledge folders query',
        'Workspace, parent folder, search, and sorting options.'
      ),
      response: documentedSchema(
        v2ListKnowledgeFoldersContract.response.schema,
        'V2KnowledgeFolderListResponse',
        'Knowledge folder list response',
        'A cursor-paginated page of knowledge-base folders.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeFolderContract,
    knowledgeOperation({
      operationId: 'createKnowledgeFolder',
      summary: 'Create Folder',
      description: `Create a folder in the knowledge-base folder tree. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created knowledge-base folder.' },
    }),
    {
      body: documentedSchema(
        v2CreateKnowledgeFolderContract.body,
        'CreateKnowledgeFolderRequest',
        'Create knowledge folder request',
        'Workspace and canonical path for a new knowledge-base folder.',
        [{ workspaceId: WORKSPACE_ID, path: '/Product' }]
      ),
      response: documentedSchema(
        v2CreateKnowledgeFolderContract.response.schema,
        'V2KnowledgeFolderResponse',
        'Knowledge folder response',
        'A single knowledge-base folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RelocateKnowledgeFolderContract,
    knowledgeOperation({
      operationId: 'relocateKnowledgeFolder',
      summary: 'Rename or Move Folder',
      description: `Rename or move a folder and atomically rewrite descendant paths. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The relocated knowledge-base folder.' },
    }),
    {
      body: documentedSchema(
        v2RelocateKnowledgeFolderContract.body,
        'RelocateKnowledgeFolderRequest',
        'Relocate knowledge folder request',
        'Current and destination canonical paths for a knowledge-base folder.',
        [
          {
            workspaceId: WORKSPACE_ID,
            path: '/Product',
            destinationPath: '/Archive/Product',
          },
        ]
      ),
      response: documentedSchema(
        v2RelocateKnowledgeFolderContract.response.schema,
        'V2KnowledgeFolderResponse',
        'Knowledge folder response',
        'A single knowledge-base folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeFolderContract,
    knowledgeOperation({
      operationId: 'deleteKnowledgeFolder',
      summary: 'Delete Folder',
      description: 'Delete a folder, optionally including nested folders and knowledge bases.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Folder deletion acknowledgement and deleted item counts.' },
    }),
    {
      query: documentedSchema(
        v2DeleteKnowledgeFolderContract.query,
        'DeleteKnowledgeFolderQuery',
        'Delete knowledge folder query',
        'Workspace, folder path, and recursive deletion option.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeFolderContract.response.schema,
        'V2DeleteKnowledgeFolderResponse',
        'Delete knowledge folder response',
        'Folder deletion acknowledgement and deleted-resource counts.'
      ),
    }
  ),
] as const

export const knowledgeOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-knowledge.json',
  info: {
    title: 'Sim API v2 — Knowledge Bases',
    description:
      'Version 2 of the Sim REST API for knowledge bases, document ingestion, resumable uploads, folders, and semantic or tag-based search.',
    version: '2.0.0',
    contact: {
      name: 'Sim Support',
      email: 'help@sim.ai',
      url: 'https://www.sim.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Knowledge Bases',
      description:
        'Create and organize knowledge bases, ingest documents, and search indexed content.',
    },
  ],
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
