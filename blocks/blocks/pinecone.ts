import { PineconeIcon } from '@/components/icons'
// You'll need to create this icon
import { PineconeResponse } from '@/tools/pinecone/types'
import { BlockConfig } from '../types'

export const PineconeBlock: BlockConfig<PineconeResponse> = {
  type: 'pinecone',
  name: 'Pinecone',
  description: 'Interact with Pinecone vector database',
  category: 'tools',
  bgColor: '#0D1117',
  icon: PineconeIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Generate Embeddings', id: 'generate' },
        { label: 'Upsert Text', id: 'upsert_text' },
        { label: 'Search Text', id: 'search_text' },
        { label: 'Fetch Vectors', id: 'fetch' },
        { label: 'Delete Vectors', id: 'delete' },
      ],
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      layout: 'full',
      placeholder: 'gcp-starter',
      condition: { field: 'operation', value: 'upsert_text' },
    },
    {
      id: 'indexName',
      title: 'Index Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-index',
      condition: { field: 'operation', value: 'upsert_text' },
    },
    // Generate embeddings fields
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'multilingual-e5-large', id: 'multilingual-e5-large' },
        { label: 'llama-text-embed-v2', id: 'llama-text-embed-v2' },
        { label: 'pinecone-sparse-english-v0', id: 'pinecone-sparse-english-v0' },
      ],
      condition: { field: 'operation', value: 'generate' },
    },
    {
      id: 'inputs',
      title: 'Text Inputs',
      type: 'long-input',
      layout: 'full',
      placeholder: '[{"text": "Your text here"}]',
      condition: { field: 'operation', value: 'generate' },
    },
    // Upsert text fields
    {
      id: 'records',
      title: 'Records',
      type: 'long-input',
      layout: 'full',
      placeholder: '[{"_id": "doc1", "text": "Your text here", "metadata": {"key": "value"}}]',
      condition: { field: 'operation', value: 'upsert_text' },
    },
    // Search text fields
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter text to search for',
      condition: { field: 'operation', value: 'search_text' },
    },
    {
      id: 'topK',
      title: 'Top K Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_text' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: 'search_text' },
    },
    // Fetch fields
    {
      id: 'ids',
      title: 'Vector IDs',
      type: 'long-input',
      layout: 'full',
      placeholder: '["vec1", "vec2"]',
      condition: { field: 'operation', value: 'fetch' },
    },
    // Common fields
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional namespace',
      condition: { field: 'operation', value: 'upsert_text' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Pinecone API key',
      password: true,
    },
  ],

  tools: {
    access: [
      'pinecone_generate_embeddings',
      'pinecone_upsert_text',
      'pinecone_search_text',
      'pinecone_fetch',
      'pinecone_delete',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'generate':
            return 'pinecone_generate_embeddings'
          case 'upsert_text':
            return 'pinecone_upsert_text'
          case 'search_text':
            return 'pinecone_search_text'
          case 'fetch':
            return 'pinecone_fetch'
          case 'delete':
            return 'pinecone_delete'
          default:
            throw new Error('Invalid operation selected')
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    environment: { type: 'string', required: false },
    indexName: { type: 'string', required: false },
    namespace: { type: 'string', required: false },
    // Generate embeddings inputs
    model: { type: 'string', required: false },
    inputs: { type: 'json', required: false },
    parameters: { type: 'json', required: false },
    // Upsert text inputs
    records: { type: 'json', required: false },
    // Search text inputs
    searchQuery: { type: 'string', required: false },
    topK: { type: 'string', required: false },
    filter: { type: 'json', required: false },
    // Fetch inputs
    ids: { type: 'json', required: false },
    // Delete inputs
    deleteAll: { type: 'boolean', required: false },
  },

  outputs: {
    response: {
      type: {
        matches: 'any',
        upsertedCount: 'any',
        data: 'any',
        model: 'any',
        vector_type: 'any',
        usage: 'any',
      },
    },
  },
}
