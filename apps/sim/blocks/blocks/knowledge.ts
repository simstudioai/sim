import { PackageSearchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  longDescription:
    'Integrate Knowledge into the workflow. Can search, upload chunks, and create documents.',
  bestPractices: `
  - Search up examples with knowledge base blocks to understand YAML syntax.
  - Clarify which tags are available for the knowledge base to understand whether to use tag filters on a search.
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
        { label: 'Upload Chunk', id: 'upload_chunk' },
        { label: 'Create Document', id: 'create_document' },
      ],
      value: () => 'search',
    },
    {
      id: 'knowledgeBaseId',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      required: true,
      condition: { field: 'operation', value: ['search', 'upload_chunk', 'create_document'] },
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
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'documentId',
      title: 'Document',
      type: 'document-selector',
      placeholder: 'Select document',
      dependsOn: ['knowledgeBaseId'],
      required: true,
      condition: { field: 'operation', value: 'upload_chunk' },
    },
    {
      id: 'content',
      title: 'Chunk Content',
      type: 'long-input',
      placeholder: 'Enter the chunk content to upload',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: 'upload_chunk' },
    },
    {
      id: 'name',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'Enter document name',
      required: true,
      condition: { field: 'operation', value: ['create_document'] },
    },
    {
      id: 'content',
      title: 'Document Content',
      type: 'long-input',
      placeholder: 'Enter the document content',
      rows: 6,
      required: true,
      condition: { field: 'operation', value: ['create_document'] },
    },
    // Dynamic tag entry for Create Document
    {
      id: 'documentTags',
      title: 'Document Tags',
      type: 'document-tag-entry',
      condition: { field: 'operation', value: 'create_document' },
    },
  ],
  tools: {
    access: ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'knowledge_search'
          case 'upload_chunk':
            return 'knowledge_upload_chunk'
          case 'create_document':
            return 'knowledge_create_document'
          default:
            return 'knowledge_search'
        }
      },
      params: (params) => {
        // Validate required fields for each operation
        if (params.operation === 'search' && !params.knowledgeBaseId) {
          throw new Error('Knowledge base ID is required for search operation')
        }
        if (
          (params.operation === 'upload_chunk' || params.operation === 'create_document') &&
          !params.knowledgeBaseId
        ) {
          throw new Error(
            'Knowledge base ID is required for upload_chunk and create_document operations'
          )
        }
        if (params.operation === 'upload_chunk' && !params.documentId) {
          throw new Error('Document ID is required for upload_chunk operation')
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
    content: { type: 'string', description: 'Content data' },
    name: { type: 'string', description: 'Document name' },
    // Dynamic tag filters for search
    tagFilters: { type: 'string', description: 'Tag filter criteria' },
    // Document tags for create document (JSON string of tag objects)
    documentTags: { type: 'string', description: 'Document tags' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results' },
    query: { type: 'string', description: 'Query used' },
    totalResults: { type: 'number', description: 'Total results count' },
  },
}
