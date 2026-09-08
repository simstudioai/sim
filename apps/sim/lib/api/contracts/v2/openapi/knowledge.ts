import {
  v2AbortKnowledgeDocumentUploadContract,
  v2AddWorkspaceFilesToKnowledgeBaseContract,
  v2BulkUpdateKnowledgeDocumentsContract,
  v2CompleteKnowledgeDocumentUploadContract,
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeConnectorContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeDocumentUploadPartUrlsContract,
  v2CreateKnowledgeFolderContract,
  v2DeleteKnowledgeBaseContract,
  v2DeleteKnowledgeConnectorContract,
  v2DeleteKnowledgeDocumentContract,
  v2DeleteKnowledgeFolderContract,
  v2GetKnowledgeBaseContract,
  v2GetKnowledgeConnectorContract,
  v2GetKnowledgeDocumentContract,
  v2ListKnowledgeBasesContract,
  v2ListKnowledgeConnectorDocumentsContract,
  v2ListKnowledgeConnectorsContract,
  v2ListKnowledgeDocumentsContract,
  v2ListKnowledgeFoldersContract,
  v2ListKnowledgeTagsContract,
  v2RelocateKnowledgeFolderContract,
  v2RestoreKnowledgeBaseContract,
  v2SearchKnowledgeContract,
  v2SyncKnowledgeConnectorContract,
  v2UpdateKnowledgeBaseContract,
  v2UpdateKnowledgeConnectorContract,
  v2UpdateKnowledgeConnectorDocumentsContract,
  v2UpdateKnowledgeDocumentContract,
  v2UploadKnowledgeDocumentContract,
  v2UploadKnowledgeDocumentFormSchema,
} from '@/lib/api/contracts/v2/knowledge'
import { knowledgeChunkOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/knowledge-chunks'
import { knowledgeTagOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/knowledge-tags'
import {
  documentedSchema,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  WORKSPACE_ERRORS,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiSuccessMetadata,
} from '@/lib/api/openapi/types'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const KNOWLEDGE_BASE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const KNOWLEDGE_CONNECTOR_ID = 'kc-9f8e7d6c'

const KNOWLEDGE_CONNECTOR_EXAMPLE = {
  id: KNOWLEDGE_CONNECTOR_ID,
  knowledgeBaseId: KNOWLEDGE_BASE_ID,
  connectorType: 'notion',
  credentialId: 'cred-4b3a2c1d',
  sourceConfig: { pageIds: ['page-123'] },
  syncMode: 'full',
  syncIntervalMinutes: 1440,
  status: 'active',
  lastSyncAt: '2026-06-20T14:02:11.000Z',
  lastSyncError: null,
  lastSyncDocCount: 42,
  nextSyncAt: '2026-06-21T14:02:11.000Z',
  consecutiveFailures: 0,
  createdAt: '2026-06-01T09:14:00.000Z',
  updatedAt: '2026-06-20T14:02:11.000Z',
} as const

const KNOWLEDGE_CONNECTOR_DOCUMENT_EXAMPLE = {
  id: 'doc-8a7b6c5d',
  filename: 'Product requirements',
  externalId: 'page-123',
  sourceUrl: 'https://www.notion.so/page-123',
  enabled: true,
  userExcluded: false,
  createdAt: '2026-06-01T09:15:00.000Z',
  processingStatus: 'completed',
} as const

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

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListKnowledgeBasesContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.list,
      operationId: 'listKnowledgeBases',
      summary: 'List Knowledge Bases',
      description: `List active knowledge bases in a workspace with folder filtering, search, sorting, and cursor pagination. Use \`scope=archived\` to find knowledge bases available for restoration. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of knowledge bases.' },
    }),
    {
      query: documentedSchema(
        v2ListKnowledgeBasesContract.query,
        'ListKnowledgeBasesQuery',
        'List knowledge bases query',
        'Workspace, lifecycle scope, folder, search, and sorting options for listing knowledge bases.'
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
      applicationOperation: knowledgeOperations.create,
      operationId: 'createKnowledgeBase',
      summary: 'Create Knowledge Base',
      description: `Create a knowledge base in a workspace with optional folder placement and chunking configuration. An unknown \`folderPath\` returns \`404\`. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created knowledge base.' },
    }),
    {
      query: v2CreateKnowledgeBaseContract.query,
      body: documentedSchema(
        v2CreateKnowledgeBaseContract.body,
        'CreateKnowledgeBaseRequest',
        'Create knowledge base request',
        'Workspace, name, description, chunking configuration, and folder placement.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: 'Product Documentation',
            folderPath: '/Product',
          },
        ]
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
      applicationOperation: knowledgeOperations.read,
      operationId: 'getKnowledgeBase',
      summary: 'Get Knowledge Base',
      description: `Get a knowledge base's metadata and document counts. Inaccessible knowledge bases return \`404\`. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
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
      applicationOperation: knowledgeOperations.update,
      operationId: 'updateKnowledgeBase',
      summary: 'Update Knowledge Base',
      description: `Update a knowledge base's name, description, chunking configuration, or folder placement. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The updated knowledge base.' },
    }),
    {
      query: v2UpdateKnowledgeBaseContract.query,
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
      applicationOperation: knowledgeOperations.delete,
      operationId: 'deleteKnowledgeBase',
      summary: 'Delete Knowledge Base',
      description:
        'Archive a knowledge base, its documents, and its connectors, pausing synchronization. Use List Knowledge Bases with `scope=archived` to find it and Restore Knowledge Base to recover it.',
      errors: RESOURCE_ERRORS,
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
    v2ListKnowledgeConnectorsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.listConnectors,
      operationId: 'listKnowledgeConnectors',
      summary: 'List Knowledge Connectors',
      description: `List external sources connected to a knowledge base with cursor pagination. Stored API keys are never returned. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of knowledge connectors.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeConnectorsContract.params,
        'ListKnowledgeConnectorsParams',
        'List knowledge connectors path parameters',
        'Knowledge base whose connectors should be listed.'
      ),
      query: documentedSchema(
        v2ListKnowledgeConnectorsContract.query,
        'ListKnowledgeConnectorsQuery',
        'List knowledge connectors query',
        'Workspace, sorting, and pagination controls.'
      ),
      response: documentedSchema(
        v2ListKnowledgeConnectorsContract.response.schema,
        'V2KnowledgeConnectorListResponse',
        'Knowledge connector list response',
        'A cursor-paginated page of connectors without secret material.',
        [{ data: [KNOWLEDGE_CONNECTOR_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeConnectorContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.createConnector,
      operationId: 'createKnowledgeConnector',
      summary: 'Create Knowledge Connector',
      description: `Validate and connect an external source, then queue its initial synchronization. The \`apiKey\` field is never returned. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The created connector without secret material.',
      },
    }),
    {
      query: v2CreateKnowledgeConnectorContract.query,
      params: documentedSchema(
        v2CreateKnowledgeConnectorContract.params,
        'CreateKnowledgeConnectorParams',
        'Create knowledge connector path parameters',
        'Knowledge base to connect to an external source.'
      ),
      body: documentedSchema(
        v2CreateKnowledgeConnectorContract.body,
        'CreateKnowledgeConnectorRequest',
        'Create knowledge connector request',
        'Workspace, connector type, authentication reference, source configuration, and sync schedule.',
        [
          {
            workspaceId: WORKSPACE_ID,
            connectorType: 'notion',
            credentialId: 'cred-4b3a2c1d',
            sourceConfig: { pageIds: ['page-123'] },
            syncIntervalMinutes: 1440,
          },
        ]
      ),
      response: documentedSchema(
        v2CreateKnowledgeConnectorContract.response.schema,
        'V2KnowledgeConnectorResponse',
        'Knowledge connector response',
        'A single connector without secret material.',
        [{ data: KNOWLEDGE_CONNECTOR_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetKnowledgeConnectorContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.readConnector,
      operationId: 'getKnowledgeConnector',
      summary: 'Get Knowledge Connector',
      description: `Get one connector and its ten most recent synchronization attempts. Stored API keys are never returned. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The connector and recent synchronization history.',
      },
    }),
    {
      params: documentedSchema(
        v2GetKnowledgeConnectorContract.params,
        'GetKnowledgeConnectorParams',
        'Get knowledge connector path parameters',
        'Knowledge connector selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetKnowledgeConnectorContract.query,
        'GetKnowledgeConnectorQuery',
        'Get knowledge connector query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2GetKnowledgeConnectorContract.response.schema,
        'V2KnowledgeConnectorDetailResponse',
        'Knowledge connector detail response',
        'A connector and recent synchronization history without secret material.',
        [{ data: { ...KNOWLEDGE_CONNECTOR_EXAMPLE, syncLogs: [] } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateKnowledgeConnectorContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.updateConnector,
      operationId: 'updateKnowledgeConnector',
      summary: 'Update Knowledge Connector',
      description: `Update connector source configuration, schedule, or active state. Replacing source configuration on a runnable connector queues an immediate synchronization; paused connectors retain the change without synchronizing until resumed. Source configuration cannot be replaced while synchronization is already in progress. Authentication material cannot be changed through this operation. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The updated connector.' },
    }),
    {
      query: v2UpdateKnowledgeConnectorContract.query,
      params: documentedSchema(
        v2UpdateKnowledgeConnectorContract.params,
        'UpdateKnowledgeConnectorParams',
        'Update knowledge connector path parameters',
        'Knowledge connector selected for update.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeConnectorContract.body,
        'UpdateKnowledgeConnectorRequest',
        'Update knowledge connector request',
        'Workspace scope and at least one mutable connector field.',
        [{ workspaceId: WORKSPACE_ID, status: 'paused' }]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeConnectorContract.response.schema,
        'V2KnowledgeConnectorResponse',
        'Knowledge connector response',
        'A single connector without secret material.',
        [{ data: KNOWLEDGE_CONNECTOR_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeConnectorContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.deleteConnector,
      operationId: 'deleteKnowledgeConnector',
      summary: 'Delete Knowledge Connector',
      description: `Delete a connector and optionally its synchronized documents. Documents are retained by default. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Connector deletion acknowledgement and document counts.',
      },
    }),
    {
      params: documentedSchema(
        v2DeleteKnowledgeConnectorContract.params,
        'DeleteKnowledgeConnectorParams',
        'Delete knowledge connector path parameters',
        'Knowledge connector selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteKnowledgeConnectorContract.query,
        'DeleteKnowledgeConnectorQuery',
        'Delete knowledge connector query',
        'Workspace scope and whether synchronized documents should also be deleted.'
      ),
      response: documentedSchema(
        v2DeleteKnowledgeConnectorContract.response.schema,
        'V2KnowledgeConnectorDeleteResponse',
        'Knowledge connector delete response',
        'Deletion acknowledgement and affected document counts.',
        [
          {
            data: {
              id: KNOWLEDGE_CONNECTOR_ID,
              deleted: true,
              documentsDeleted: 0,
              documentsKept: 42,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2SyncKnowledgeConnectorContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.syncConnector,
      operationId: 'syncKnowledgeConnector',
      summary: 'Sync Knowledge Connector',
      description: `Queue a connector synchronization. Rehydration forces existing documents to be fetched and indexed again. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Synchronization was queued.' },
    }),
    {
      query: v2SyncKnowledgeConnectorContract.query,
      params: documentedSchema(
        v2SyncKnowledgeConnectorContract.params,
        'SyncKnowledgeConnectorParams',
        'Sync knowledge connector path parameters',
        'Knowledge connector selected for synchronization.'
      ),
      body: documentedSchema(
        v2SyncKnowledgeConnectorContract.body,
        'SyncKnowledgeConnectorRequest',
        'Sync knowledge connector request',
        'Workspace scope and optional full rehydration control.',
        [{ workspaceId: WORKSPACE_ID, rehydrate: false }]
      ),
      response: documentedSchema(
        v2SyncKnowledgeConnectorContract.response.schema,
        'V2KnowledgeConnectorSyncResponse',
        'Knowledge connector sync response',
        'Acknowledgement that synchronization was queued.',
        [{ data: { id: KNOWLEDGE_CONNECTOR_ID, syncTriggered: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListKnowledgeConnectorDocumentsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.listConnectorDocuments,
      operationId: 'listKnowledgeConnectorDocuments',
      summary: 'List Knowledge Connector Documents',
      description: `List documents produced by one connector with opaque cursor pagination. Excluded documents are omitted unless explicitly requested. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of connector documents.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeConnectorDocumentsContract.params,
        'ListKnowledgeConnectorDocumentsParams',
        'List knowledge connector documents path parameters',
        'Knowledge connector whose documents should be listed.'
      ),
      query: documentedSchema(
        v2ListKnowledgeConnectorDocumentsContract.query,
        'ListKnowledgeConnectorDocumentsQuery',
        'List knowledge connector documents query',
        'Workspace, exclusion filter, and pagination controls.'
      ),
      response: documentedSchema(
        v2ListKnowledgeConnectorDocumentsContract.response.schema,
        'V2KnowledgeConnectorDocumentListResponse',
        'Knowledge connector document list response',
        'A cursor-paginated page of connector documents.',
        [{ data: [KNOWLEDGE_CONNECTOR_DOCUMENT_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateKnowledgeConnectorDocumentsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.updateConnectorDocuments,
      operationId: 'updateKnowledgeConnectorDocuments',
      summary: 'Update Knowledge Connector Documents',
      description: `Exclude connector documents from knowledge search or restore previously excluded documents. Only documents produced by the selected connector can change. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The selected connector documents were updated.',
      },
    }),
    {
      query: v2UpdateKnowledgeConnectorDocumentsContract.query,
      params: documentedSchema(
        v2UpdateKnowledgeConnectorDocumentsContract.params,
        'UpdateKnowledgeConnectorDocumentsParams',
        'Update knowledge connector documents path parameters',
        'Knowledge connector whose documents should be updated.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeConnectorDocumentsContract.body,
        'UpdateKnowledgeConnectorDocumentsRequest',
        'Update knowledge connector documents request',
        'Workspace, restore or exclude operation, and selected document identifiers.',
        [
          {
            workspaceId: WORKSPACE_ID,
            operation: 'exclude',
            documentIds: [KNOWLEDGE_CONNECTOR_DOCUMENT_EXAMPLE.id],
          },
        ]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeConnectorDocumentsContract.response.schema,
        'V2KnowledgeConnectorDocumentsUpdateResponse',
        'Knowledge connector documents update response',
        'Operation result and identifiers actually changed.',
        [
          {
            data: {
              operation: 'exclude',
              updatedCount: 1,
              documentIds: [KNOWLEDGE_CONNECTOR_DOCUMENT_EXAMPLE.id],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2SearchKnowledgeContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.search,
      operationId: 'searchKnowledge',
      summary: 'Search Knowledge',
      description:
        'Search one or more knowledge bases with semantic vector retrieval, optional hybrid full-text retrieval, and structured tag filters. Every result names the `knowledgeBaseId` it came from. A request body over 2 MiB is a `413`.',
      errors: [...WORKSPACE_ERRORS, 'UsageLimitExceeded', 'NotFound', 'PayloadTooLarge'],
      success: {
        description: 'Matching document chunks ordered by relevance.',
      },
    }),
    {
      query: v2SearchKnowledgeContract.query,
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
    v2ListKnowledgeTagsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.listTags,
      operationId: 'listKnowledgeTags',
      summary: 'List Tags',
      description: `List the knowledge base's tag definitions with display names, write slots, and field types. Filters and document reads use display names; document writes use slots. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The knowledge base tag vocabulary.' },
    }),
    {
      params: documentedSchema(
        v2ListKnowledgeTagsContract.params,
        'ListKnowledgeTagsParams',
        'List knowledge tags path parameters',
        'Knowledge base whose tags should be listed.'
      ),
      query: documentedSchema(
        v2ListKnowledgeTagsContract.query,
        'ListKnowledgeTagsQuery',
        'List knowledge tags query',
        'Workspace scope for the knowledge base.'
      ),
      response: documentedSchema(
        v2ListKnowledgeTagsContract.response.schema,
        'V2KnowledgeTagListResponse',
        'Knowledge tag list response',
        'The full tag vocabulary of one knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListKnowledgeDocumentsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.listDocuments,
      operationId: 'listKnowledgeDocuments',
      summary: 'List Documents',
      description:
        'List documents with filename search, state and tag filters, sorting, and cursor pagination. Tag values use display names; use List Tags to resolve the slots required for writes.',
      errors: RESOURCE_ERRORS,
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
        'Workspace, pagination, filtering, tag filtering, search, and sorting options.'
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
    v2BulkUpdateKnowledgeDocumentsContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.bulkDocuments,
      operationId: 'bulkUpdateKnowledgeDocuments',
      summary: 'Bulk Enable or Disable Documents',
      description: `Enable or disable selected documents, or use \`selectAll\` for the entire knowledge base. Use Delete Document to remove documents individually. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The number and identifiers of the documents that changed.',
      },
    }),
    {
      query: v2BulkUpdateKnowledgeDocumentsContract.query,
      params: documentedSchema(
        v2BulkUpdateKnowledgeDocumentsContract.params,
        'BulkUpdateKnowledgeDocumentsParams',
        'Bulk knowledge document path parameters',
        'Knowledge base whose documents should be updated.'
      ),
      body: documentedSchema(
        v2BulkUpdateKnowledgeDocumentsContract.body,
        'BulkUpdateKnowledgeDocumentsRequest',
        'Bulk knowledge document request',
        'Operation and the documents it applies to.',
        [
          {
            workspaceId: WORKSPACE_ID,
            operation: 'disable',
            documentIds: ['b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12'],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkUpdateKnowledgeDocumentsContract.response.schema,
        'V2BulkKnowledgeDocumentsResponse',
        'Bulk knowledge document response',
        'Outcome of a bulk enable or disable.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UploadKnowledgeDocumentContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.uploadDocument,
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
      applicationOperation: knowledgeOperations.uploadCreate,
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
      success: {
        description: 'The created upload session and transfer instructions.',
      },
    }),
    {
      query: v2CreateKnowledgeDocumentUploadContract.query,
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
      applicationOperation: knowledgeOperations.uploadCancel,
      operationId: 'abortKnowledgeDocumentUpload',
      summary: 'Abort Document Upload',
      description:
        'Abort an incomplete upload session and discard its uploaded data. Completed uploads cannot be aborted.',
      errors: RESOURCE_CONFLICT_ERRORS,
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
      applicationOperation: knowledgeOperations.uploadParts,
      operationId: 'createKnowledgeDocumentUploadPartUrls',
      summary: 'Create Document Upload Part URLs',
      description: 'Create short-lived signed PUT URLs for up to 100 multipart part numbers.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
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
      applicationOperation: knowledgeOperations.uploadComplete,
      operationId: 'completeKnowledgeDocumentUpload',
      summary: 'Complete Document Upload',
      description:
        'Verify a direct upload or assemble multipart parts, create the knowledge document, and queue asynchronous processing.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict'],
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
      applicationOperation: knowledgeOperations.readDocument,
      operationId: 'getKnowledgeDocument',
      summary: 'Get Document',
      description: 'Get document metadata, processing status, and source connector details.',
      errors: RESOURCE_ERRORS,
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
    v2UpdateKnowledgeDocumentContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.updateDocument,
      operationId: 'updateKnowledgeDocument',
      summary: 'Update Document',
      description: `Rename a document, change search availability, update tag slots, or requeue processing. Omitted fields remain unchanged; indexing state is read-only. Use List Tags to resolve names to slots and Get Document for source connector details, which this response omits. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The updated document, or the requeue acknowledgement.',
      },
    }),
    {
      query: v2UpdateKnowledgeDocumentContract.query,
      params: documentedSchema(
        v2UpdateKnowledgeDocumentContract.params,
        'UpdateKnowledgeDocumentParams',
        'Update knowledge document path parameters',
        'Knowledge base and document selected for update.'
      ),
      body: documentedSchema(
        v2UpdateKnowledgeDocumentContract.body,
        'UpdateKnowledgeDocumentRequest',
        'Update knowledge document request',
        'Filename, search state, tag slot values, or a processing retry.',
        [{ workspaceId: WORKSPACE_ID, enabled: false, tag1: 'billing' }]
      ),
      response: documentedSchema(
        v2UpdateKnowledgeDocumentContract.response.schema,
        'V2UpdateKnowledgeDocumentResponse',
        'Update knowledge document response',
        'The updated document, or the processing requeue acknowledgement.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteKnowledgeDocumentContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.deleteDocument,
      operationId: 'deleteKnowledgeDocument',
      summary: 'Delete Document',
      description:
        'Remove a document from listings and search. Uploaded documents and their chunks are deleted. Connector documents are excluded while retaining their stored data; later synchronization does not re-add them.',
      errors: RESOURCE_ERRORS,
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
      applicationOperation: knowledgeOperations.listFolders,
      operationId: 'listKnowledgeFolders',
      summary: 'List Folders',
      description: `List folders in the knowledge-base folder tree with filtering and sorting. ${FULL_SET_LIST} ${FOLDER_TREE_TOO_LARGE}`,
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
        'The whole bounded set of knowledge-base folders, in one page.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateKnowledgeFolderContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.createFolder,
      operationId: 'createKnowledgeFolder',
      summary: 'Create Folder',
      description: `Create a folder in the knowledge-base folder tree. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created knowledge-base folder.' },
    }),
    {
      query: v2CreateKnowledgeFolderContract.query,
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
      applicationOperation: knowledgeOperations.relocateFolder,
      operationId: 'relocateKnowledgeFolder',
      summary: 'Rename or Move Folder',
      description: `Rename or move a folder and atomically rewrite descendant paths. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The relocated knowledge-base folder.' },
    }),
    {
      query: v2RelocateKnowledgeFolderContract.query,
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
      applicationOperation: knowledgeOperations.deleteFolder,
      operationId: 'deleteKnowledgeFolder',
      summary: 'Delete Folder',
      description:
        'Archive an empty folder, or set `recursive=true` to archive its subfolders and knowledge bases. Use Restore Knowledge Base to recover knowledge bases.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Folder deletion acknowledgement and deleted item counts.',
      },
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
  defineOpenApiRoute(
    v2RestoreKnowledgeBaseContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.restore,
      operationId: 'restoreKnowledgeBase',
      summary: 'Restore Knowledge Base',
      description: `Restore a knowledge base and the documents and connectors archived with it. Active knowledge bases return unchanged without a new audit event. An archived workspace returns \`409\`; an archived containing folder moves the restored knowledge base to the workspace root. ${FOLDER_TREE_TOO_LARGE}`,
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The restored knowledge base.' },
    }),
    {
      query: v2RestoreKnowledgeBaseContract.query,
      params: documentedSchema(
        v2RestoreKnowledgeBaseContract.params,
        'RestoreKnowledgeBaseParams',
        'Restore knowledge base path parameters',
        'Knowledge base selected for restoration.'
      ),
      body: documentedSchema(
        v2RestoreKnowledgeBaseContract.body,
        'RestoreKnowledgeBaseRequest',
        'Restore knowledge base request',
        'Workspace scope for the knowledge base.',
        [{ workspaceId: WORKSPACE_ID }]
      ),
      response: documentedSchema(
        v2RestoreKnowledgeBaseContract.response.schema,
        'V2KnowledgeBaseResponse',
        'Knowledge base response',
        'A single knowledge base.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddWorkspaceFilesToKnowledgeBaseContract,
    knowledgeOperation({
      applicationOperation: knowledgeOperations.addWorkspaceFiles,
      operationId: 'addWorkspaceFilesToKnowledgeBase',
      summary: 'Index Workspace Files',
      description: `Queue stored workspace files for indexing without re-uploading bytes. Unreadable, unsupported, or over-100 MB files appear in \`failed\`; valid files are queued. Partial success returns \`200\`. Use Get Document to poll processing after receiving document IDs. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'UsageLimitExceeded'],
      success: {
        description: 'Files queued for indexing, with any that could not be.',
      },
    }),
    {
      query: v2AddWorkspaceFilesToKnowledgeBaseContract.query,
      params: documentedSchema(
        v2AddWorkspaceFilesToKnowledgeBaseContract.params,
        'AddWorkspaceFilesToKnowledgeBaseParams',
        'Index workspace files path parameters',
        'Knowledge base the files are indexed into.'
      ),
      body: documentedSchema(
        v2AddWorkspaceFilesToKnowledgeBaseContract.body,
        'AddWorkspaceFilesToKnowledgeBaseRequest',
        'Index workspace files request',
        'Workspace scope and the workspace file references to index.',
        [{ workspaceId: WORKSPACE_ID, fileReferences: ['handbook.pdf'] }]
      ),
      response: documentedSchema(
        v2AddWorkspaceFilesToKnowledgeBaseContract.response.schema,
        'V2AddWorkspaceFilesToKnowledgeBaseResponse',
        'Index workspace files response',
        'Documents queued for indexing and references that could not be.'
      ),
    }
  ),
  ...knowledgeChunkOpenApiRoutes,
  ...knowledgeTagOpenApiRoutes,
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

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
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: withErrorExamples({
    Conflict: { message: 'Upload has already been completed' },
  }),
  routes,
})
