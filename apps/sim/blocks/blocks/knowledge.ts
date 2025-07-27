import { PackageSearchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  longDescription:
    'Perform semantic vector search across knowledge bases, upload individual chunks to existing documents, or create new documents from text content. Uses advanced AI embeddings to understand meaning and context for search operations.',
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  category: 'blocks',
  docsLink: 'https://docs.simstudio.ai/blocks/knowledge',
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

        // For create_document operation, map createTag fields to tag fields
        if (params.operation === 'create_document') {
          const mappedParams = { ...params }

          // Map createTag fields to tag fields
          if (params.createTag1) mappedParams.tag1 = params.createTag1
          if (params.createTag2) mappedParams.tag2 = params.createTag2
          if (params.createTag3) mappedParams.tag3 = params.createTag3
          if (params.createTag4) mappedParams.tag4 = params.createTag4
          if (params.createTag5) mappedParams.tag5 = params.createTag5
          if (params.createTag6) mappedParams.tag6 = params.createTag6
          if (params.createTag7) mappedParams.tag7 = params.createTag7

          // Remove createTag fields from the final params
          mappedParams.createTag1 = undefined
          mappedParams.createTag2 = undefined
          mappedParams.createTag3 = undefined
          mappedParams.createTag4 = undefined
          mappedParams.createTag5 = undefined
          mappedParams.createTag6 = undefined
          mappedParams.createTag7 = undefined

          return mappedParams
        }

        return params
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    knowledgeBaseId: { type: 'string', required: false },
    query: { type: 'string', required: false },
    topK: { type: 'number', required: false },
    documentId: { type: 'string', required: false },
    content: { type: 'string', required: false },
    name: { type: 'string', required: false },
    // Dynamic tag filters for search
    tagFilters: { type: 'string', required: false },
    // Tag values for create document
    createTag1: { type: 'string', required: false },
    createTag2: { type: 'string', required: false },
    createTag3: { type: 'string', required: false },
    createTag4: { type: 'string', required: false },
    createTag5: { type: 'string', required: false },
    createTag6: { type: 'string', required: false },
    createTag7: { type: 'string', required: false },
  },
  outputs: {
    results: 'json',
    query: 'string',
    totalResults: 'number',
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      condition: { field: 'operation', value: ['search', 'upload_chunk', 'create_document'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your search query',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'topK',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter number of results (default: 10)',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'tagFilters',
      title: 'Tag Filters',
      type: 'knowledge-tag-filters',
      layout: 'full',
      placeholder: 'Add tag filters',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'documentId',
      title: 'Document',
      type: 'document-selector',
      layout: 'full',
      placeholder: 'Select document',
      condition: { field: 'operation', value: 'upload_chunk' },
    },
    {
      id: 'content',
      title: 'Chunk Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the chunk content to upload',
      rows: 6,
      condition: { field: 'operation', value: 'upload_chunk' },
    },
    {
      id: 'name',
      title: 'Document Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter document name',
      condition: { field: 'operation', value: ['create_document'] },
    },
    {
      id: 'content',
      title: 'Document Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the document content',
      rows: 6,
      condition: { field: 'operation', value: ['create_document'] },
    },
    // Tag inputs for Create Document (in advanced mode)
    {
      id: 'createTag1',
      title: 'Tag 1', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 1 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag2',
      title: 'Tag 2', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 2 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag3',
      title: 'Tag 3', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 3 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag4',
      title: 'Tag 4', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 4 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag5',
      title: 'Tag 5', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 5 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag6',
      title: 'Tag 6', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 6 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
    {
      id: 'createTag7',
      title: 'Tag 7', // This will be dynamically updated by the component
      type: 'knowledge-tag-filter',
      layout: 'half',
      placeholder: 'Enter tag 7 value',
      condition: { field: 'operation', value: 'create_document' },
      mode: 'advanced',
    },
  ],
}
