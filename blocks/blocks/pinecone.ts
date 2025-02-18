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
        { label: 'Query', id: 'query' },
        { label: 'Upsert', id: 'upsert' },
        { label: 'Delete', id: 'delete' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Pinecone API key',
      password: true,
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      layout: 'full',
      placeholder: 'gcp-starter',
    },
    {
      id: 'indexName',
      title: 'Index Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-index',
    },
    // Query operation fields
    {
      id: 'queryVector',
      title: 'Query Vector',
      type: 'long-input',
      layout: 'full',
      placeholder: '[0.1, 0.2, 0.3, ...]',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'topK',
      title: 'Top K Results',
      type: 'short-input',
      layout: 'half',
      placeholder: '10',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'includeMetadata',
      title: 'Include Metadata',
      type: 'switch',
      layout: 'half',
      value: () => 'true',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'includeValues',
      title: 'Include Values',
      type: 'switch',
      layout: 'half',
      value: () => 'false',
      condition: { field: 'operation', value: 'query' },
    },
    // Upsert operation fields
    {
      id: 'vectors',
      title: 'Vectors',
      type: 'long-input',
      layout: 'full',
      placeholder: '[{"id": "vec1", "values": [0.1, 0.2, 0.3], "metadata": {"key": "value"}}]',
      condition: { field: 'operation', value: 'upsert' },
    },
    // Delete operation fields
    {
      id: 'ids',
      title: 'Vector IDs',
      type: 'long-input',
      layout: 'full',
      placeholder: '["vec1", "vec2", ...]',
      condition: { field: 'operation', value: 'delete' },
    },
    {
      id: 'deleteAll',
      title: 'Delete All Vectors',
      type: 'switch',
      layout: 'half',
      value: () => 'false',
      condition: { field: 'operation', value: 'delete' },
    },
  ],

  tools: {
    access: ['pinecone_query', 'pinecone_upsert', 'pinecone_delete'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'pinecone_query'
          case 'upsert':
            return 'pinecone_upsert'
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
    environment: { type: 'string', required: true },
    indexName: { type: 'string', required: true },
    // Query operation inputs
    queryVector: { type: 'json', required: false },
    topK: { type: 'number', required: false },
    includeMetadata: { type: 'boolean', required: false },
    includeValues: { type: 'boolean', required: false },
    // Upsert operation inputs
    vectors: { type: 'json', required: false },
    // Delete operation inputs
    ids: { type: 'json', required: false },
    deleteAll: { type: 'boolean', required: false },
  },

  outputs: {
    response: {
      type: {
        matches: 'any',
        upsertedCount: 'any',
        deletedCount: 'any',
      },
    },
  },
}
