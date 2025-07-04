import { PackageSearchIcon } from '@/components/icons'
import type { BlockConfig } from '../types'

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
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    knowledgeBaseIds: { type: 'string', required: false },
    knowledgeBaseId: { type: 'string', required: false },
    query: { type: 'string', required: false },
    topK: { type: 'number', required: false },
    documentId: { type: 'string', required: false },
    content: { type: 'string', required: false },
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
      id: 'knowledgeBaseIds',
      title: 'Knowledge Bases',
      type: 'knowledge-base-selector',
      layout: 'full',
      placeholder: 'Select knowledge bases',
      multiSelect: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'knowledgeBaseId',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      layout: 'full',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      condition: { field: 'operation', value: ['upload_chunk', 'create_document'] },
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
  ],
}
