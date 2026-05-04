import { PackageSearchIcon } from '@/components/icons'
import { DEFAULT_RERANKER_MODEL, SUPPORTED_RERANKER_MODELS } from '@/lib/knowledge/reranker-models'
import type { BlockConfig } from '@/blocks/types'
import { getCohereRerankerApiKeyCondition } from '@/blocks/utils'

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  longDescription:
    'Integrate Knowledge into the workflow. Perform full CRUD operations on documents, chunks, and tags.',
  bestPractices: `
  - Clarify which tags are available for the knowledge base to understand whether to use tag filters on a search.
  - Use List Documents to enumerate documents before operating on them.
  - Use Get Document to retrieve full details including tags, connector metadata, and processing status.
  - Use List Chunks to inspect a document's contents before updating or deleting chunks.
  - Use List Connectors to see which external sources are syncing documents into the knowledge base.
  - Use Get Connector to check sync health and review recent sync logs.
  `,
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/blocks/knowledge',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Get Document', id: 'get_document' },
        { label: 'Create Document', id: 'create_document' },
        { label: 'Upsert Document', id: 'upsert_document' },
        { label: 'Delete Document', id: 'delete_document' },
        { label: 'List Chunks', id: 'list_chunks' },
        { label: 'Upload Chunk', id: 'upload_chunk' },
        { label: 'Update Chunk', id: 'update_chunk' },
        { label: 'Delete Chunk', id: 'delete_chunk' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'List Connectors', id: 'list_connectors' },
        { label: 'Get Connector', id: 'get_connector' },
        { label: 'Trigger Sync', id: 'trigger_sync' },
      ],
      value: () => 'search',
    },
    // Knowledge base selector - basic mode
    {
      id: 'knowledgeBaseSelector',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      canonicalParamId: 'knowledgeBaseId',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      required: true,
      mode: 'basic',
    },
    // Knowledge base ID - advanced mode
    {
      id: 'manualKnowledgeBaseId',
      title: 'Knowledge Base ID',
      type: 'short-input',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'advanced',
      placeholder: 'Enter knowledge base ID',
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query (optional when using tag filters)',
      required: false,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'topK',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: 'Enter number of results (default: 10)',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'tagFilters',
      title: 'Tag Filters',
      type: 'knowledge-tag-filters',
      placeholder: 'Add tag filters',
      dependsOn: ['knowledgeBaseSelector'],
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'rerankerEnabled',
      title: 'Rerank Results',
      type: 'switch',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'rerankerModel',
      title: 'Rerank Model',
      type: 'dropdown',
      options: SUPPORTED_RERANKER_MODELS.map((id) => ({ label: id, id })),
      value: () => DEFAULT_RERANKER_MODEL,
      condition: {
        field: 'operation',
        value: 'search',
        and: { field: 'rerankerEnabled', value: true },
      },
    },
    {
      id: 'rerankerInputCount',
      title: 'Documents Sent to Reranker',
      type: 'short-input',
      placeholder: 'Auto (4× results, capped at 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'search',
        and: { field: 'rerankerEnabled', value: true },
      },
    },
    {
      id: 'apiKey',
      title: 'Cohere API Key',
      type: 'short-input',
      placeholder: 'Enter your Cohere API key',
      password: true,
      connectionDroppable: false,
      required: true,
      condition: getCohereRerankerApiKeyCondition(),
    },

    // --- List Documents ---
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter documents by filename',
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'enabledFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Enabled', id: 'enabled' },
        { label: 'Disabled', id: 'disabled' },
      ],
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max items to return (default: 50)',
      condition: { field: 'operation', value: ['list_documents', 'list_chunks'] },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Number of items to skip (default: 0)',
      condition: { field: 'operation', value: ['list_documents', 'list_chunks'] },
    },

    // Document selector — basic mode (visual selector)
    {
      id: 'documentSelector',
      title: 'Document',
      type: 'document-selector',
      canonicalParamId: 'documentId',
      serviceId: 'knowledge',
      selectorKey: 'knowledge.documents',
      placeholder: 'Select document',
      dependsOn: ['knowledgeBaseSelector'],
      required: true,
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ],
      },
    },
    // Document selector — advanced mode (manual ID input)
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      canonicalParamId: 'documentId',
      placeholder: 'Enter document ID',
      dependsOn: ['knowledgeBaseId'],
      required: true,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ],
      },
    },

    // --- Upload Chunk ---
    {
      id: 'content',
      title: 'Chunk Content',
      type: 'long-input',
      placeholder: 'Enter the chunk content to upload',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: 'upload_chunk' },
    },

    // --- Create Document / Upsert Document ---
    {
      id: 'name',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'Enter document name',
      required: true,
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },
    {
      id: 'content',
      title: 'Document Content',
      type: 'long-input',
      placeholder: 'Enter the document content',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },
    {
      id: 'upsertDocumentId',
      title: 'Document ID (Optional)',
      type: 'short-input',
      placeholder: 'Enter existing document ID to update (or leave empty to match by name)',
      condition: { field: 'operation', value: 'upsert_document' },
    },
    {
      id: 'documentTags',
      title: 'Document Tags',
      type: 'document-tag-entry',
      dependsOn: ['knowledgeBaseSelector'],
      condition: { field: 'operation', value: ['create_document', 'upsert_document'] },
    },

    // --- Update Chunk / Delete Chunk ---
    {
      id: 'chunkId',
      title: 'Chunk ID',
      type: 'short-input',
      placeholder: 'Enter chunk ID',
      required: true,
      condition: { field: 'operation', value: ['update_chunk', 'delete_chunk'] },
    },
    {
      id: 'content',
      title: 'New Content',
      type: 'long-input',
      placeholder: 'Enter updated chunk content',
      rows: 6,
      condition: { field: 'operation', value: 'update_chunk' },
    },
    {
      id: 'enabled',
      title: 'Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'update_chunk' },
    },

    // --- Connector operations ---
    {
      id: 'connectorId',
      title: 'Connector ID',
      type: 'short-input',
      placeholder: 'Enter connector ID',
      required: true,
      condition: { field: 'operation', value: ['get_connector', 'trigger_sync'] },
    },

    // --- List Chunks ---
    {
      id: 'chunkSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter chunks by content',
      condition: { field: 'operation', value: 'list_chunks' },
    },
    {
      id: 'chunkEnabledFilter',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      condition: { field: 'operation', value: 'list_chunks' },
    },
  ],
  tools: {
    access: [
      'knowledge_search',
      'knowledge_upload_chunk',
      'knowledge_create_document',
      'knowledge_upsert_document',
      'knowledge_list_tags',
      'knowledge_list_documents',
      'knowledge_get_document',
      'knowledge_delete_document',
      'knowledge_list_chunks',
      'knowledge_update_chunk',
      'knowledge_delete_chunk',
      'knowledge_list_connectors',
      'knowledge_get_connector',
      'knowledge_trigger_sync',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'knowledge_search'
          case 'upload_chunk':
            return 'knowledge_upload_chunk'
          case 'create_document':
            return 'knowledge_create_document'
          case 'upsert_document':
            return 'knowledge_upsert_document'
          case 'list_tags':
            return 'knowledge_list_tags'
          case 'list_documents':
            return 'knowledge_list_documents'
          case 'get_document':
            return 'knowledge_get_document'
          case 'delete_document':
            return 'knowledge_delete_document'
          case 'list_chunks':
            return 'knowledge_list_chunks'
          case 'update_chunk':
            return 'knowledge_update_chunk'
          case 'delete_chunk':
            return 'knowledge_delete_chunk'
          case 'list_connectors':
            return 'knowledge_list_connectors'
          case 'get_connector':
            return 'knowledge_get_connector'
          case 'trigger_sync':
            return 'knowledge_trigger_sync'
          default:
            return 'knowledge_search'
        }
      },
      params: (params) => {
        const knowledgeBaseId = params.knowledgeBaseId ? String(params.knowledgeBaseId).trim() : ''
        if (!knowledgeBaseId) {
          throw new Error('Knowledge base ID is required')
        }
        params.knowledgeBaseId = knowledgeBaseId

        const docOps = [
          'get_document',
          'upload_chunk',
          'delete_document',
          'list_chunks',
          'update_chunk',
          'delete_chunk',
        ]
        if (docOps.includes(params.operation)) {
          const documentId = params.documentId ? String(params.documentId).trim() : ''
          if (!documentId) {
            throw new Error(`Document ID is required for ${params.operation} operation`)
          }
          params.documentId = documentId
        }

        const chunkOps = ['update_chunk', 'delete_chunk']
        if (chunkOps.includes(params.operation)) {
          const chunkId = params.chunkId ? String(params.chunkId).trim() : ''
          if (!chunkId) {
            throw new Error(`Chunk ID is required for ${params.operation} operation`)
          }
          params.chunkId = chunkId
        }

        const connectorOps = ['get_connector', 'trigger_sync']
        if (connectorOps.includes(params.operation)) {
          const connectorId = params.connectorId ? String(params.connectorId).trim() : ''
          if (!connectorId) {
            throw new Error(`Connector ID is required for ${params.operation} operation`)
          }
          params.connectorId = connectorId
        }

        // Map list_chunks sub-block fields to tool params
        if (params.operation === 'list_chunks') {
          if (params.chunkSearch) params.search = params.chunkSearch
          if (params.chunkEnabledFilter) params.enabled = params.chunkEnabledFilter
        }

        // Map upsert sub-block field to tool param
        if (params.operation === 'upsert_document' && params.upsertDocumentId) {
          params.documentId = String(params.upsertDocumentId).trim()
        }

        // Convert enabled dropdown string to boolean for update_chunk
        if (params.operation === 'update_chunk' && typeof params.enabled === 'string') {
          params.enabled = params.enabled === 'true'
        }

        return params
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    knowledgeBaseId: { type: 'string', description: 'Knowledge base identifier' },
    query: { type: 'string', description: 'Search query terms' },
    topK: { type: 'number', description: 'Number of results' },
    documentId: { type: 'string', description: 'Document identifier' },
    chunkId: { type: 'string', description: 'Chunk identifier' },
    content: { type: 'string', description: 'Content data' },
    name: { type: 'string', description: 'Document name' },
    search: { type: 'string', description: 'Search filter for documents' },
    enabledFilter: { type: 'string', description: 'Filter by enabled status' },
    enabled: { type: 'string', description: 'Enable or disable a chunk' },
    limit: { type: 'number', description: 'Max items to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    tagFilters: { type: 'string', description: 'Tag filter criteria' },
    rerankerEnabled: { type: 'boolean', description: 'Apply Cohere reranking to search results' },
    rerankerModel: { type: 'string', description: 'Cohere rerank model identifier' },
    rerankerInputCount: {
      type: 'number',
      description: 'Number of vector results sent to the Cohere reranker (1–100)',
    },
    apiKey: { type: 'string', description: 'Cohere API key (self-hosted only)' },
    documentTags: { type: 'string', description: 'Document tags' },
    chunkSearch: { type: 'string', description: 'Search filter for chunks' },
    chunkEnabledFilter: { type: 'string', description: 'Filter chunks by enabled status' },
    upsertDocumentId: { type: 'string', description: 'Document ID for upsert operation' },
    connectorId: { type: 'string', description: 'Connector identifier' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results' },
    query: { type: 'string', description: 'Query used' },
    totalResults: { type: 'number', description: 'Total results count' },
  },
}
