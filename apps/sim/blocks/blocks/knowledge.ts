import { PackageSearchIcon } from '@/components/icons'
import type { BlockConfig } from '../types'

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Use vector search',
  longDescription:
    'Perform semantic vector search across one or more knowledge bases or upload new chunks to documents. Uses advanced AI embeddings to understand meaning and context for search operations.',
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  category: 'blocks',
  docsLink: 'https://docs.simstudio.ai/blocks/knowledge',
  tools: {
    access: ['knowledge_search', 'knowledge_upload_chunk'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
            return 'knowledge_search'
          case 'upload_chunk':
            return 'knowledge_upload_chunk'
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
    response: {
      type: {
        results: 'json',
        query: 'string',
        totalResults: 'number',
      },
    },
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
      condition: { field: 'operation', value: 'upload_chunk' },
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
  ],
}
