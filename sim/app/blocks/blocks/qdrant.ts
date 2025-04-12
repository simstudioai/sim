import { QdrantIcon } from '@/components/icons'
import { BlockConfig } from '../types'
import { QdrantResponse } from '@/tools/qdrant/types'

export const QdrantBlock: BlockConfig<QdrantResponse> = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Interact with Qdrant for RAG workflows.',
  longDescription: 'This block provides a simple UI to manage Qdrant operations, including creating collections, inserting vectors, and executing vector similarity and filter queries. It also supports connection management with API key authentication, customizable index host, vector dimension, and distance metric for collection creation; as well as filter conditions for search.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: QdrantIcon,

  // Define UI configuration subblocks
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Create Collection', id: 'create' },
        { label: 'Upsert Points', id: 'upsert' },
        { label: 'Search With Vector', id: 'search' },
        { label: 'Retrieve Points', id: 'retrieve' },
      ]
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Qdrant API key',
    },
    {
      id: 'collectionName',
      title: 'Collection Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the Qdrant collection',
    },
    {
      id: 'indexHost',
      title: 'Index Host',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Qdrant index host URL (e.g., https://your-endpoint)',
    },
    // Fields specific to Create Collection
    {
      id: 'dimension',
      title: 'Vector Dimension',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter vector dimension (>=1)',
      condition: { field: 'operation', value: 'create' }
    },
    {
      id: 'distance',
      title: 'Distance Metric',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Cosine', id: 'Cosine' },
        { label: 'Euclid', id: 'Euclid' },
        { label: 'Dot', id: 'Dot' },
        { label: 'Manhattan', id: 'Manhattan' },
      ],
      placeholder: 'Select distance metric',
      condition: { field: 'operation', value: 'create' }
    },
    // Field for Upsert Points
    {
      id: 'vectors',
      title: 'Vector Data (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '[{"id":1,"vector":[0.1,0.2,0.3],"payload":{"color":"red"}},{"id":2,"vector":[0.4,0.5,0.6],"payload":{"color":"blue"}}]',
      condition: { field: 'operation', value: 'upsert' }
    },
    // Fields for Search operation
    {
      id: 'searchVector',
      title: 'Search Vector',
      type: 'long-input',
      layout: 'full',
      placeholder: '[0.2,0.1,0.9]',
      condition: { field: 'operation', value: 'search' }
    },
    {
      id: 'topK',
      title: 'Top K Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
    },
    // New field for Search Filter (JSON)
    {
      id: 'filter',
      title: 'Search Filter (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"must": [{"key": "city", "match": {"value": "London"}}]}',
      condition: { field: 'operation', value: 'search' }
    },
    // Fields for Retrieve Points
    {
      id: 'ids',
      title: 'Vector IDs',
      type: 'long-input',
      layout: 'full',
      placeholder: '["vec1", "vec2"]',
      condition: { field: 'operation', value: 'retrieve' },
    },
  ],

  tools: {
    access: [
      'qdrant_create', 
      'qdrant_insert', 
      'qdrant_similarity', 
      'qdrant_fetch'
    ],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'create':
            return 'qdrant_create'
          case 'upsert':
            return 'qdrant_insert'
          case 'search':
            return 'qdrant_similarity'
          case 'retrieve':
            return 'qdrant_fetch'
          default:
            throw new Error("Invalid operation selected");
        }
      }
    }
  },

  inputs: {
    apiKey: { type: 'string', required: true },
    collectionName: { type: 'string', required: true },
    indexHost: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    // Inputs for Create Collection:
    dimension: { type: 'number', required: false },
    distance: { type: 'string', required: false },
    // For Upsert
    vectors: { type: 'json', required: false },
    // For Search
    searchVector: { type: 'json', required: false },
    topK: { type: 'string', required: false },
    // New input for Filter:
    filter: { type: 'json', required: false },
    // For Retrieve
    ids: { type: 'json', required: false },
  },

  outputs: {
    response: {
      type: {
        result: 'any',
        inserted: 'any',
        results: 'any',
        vectors: 'any',
      }
    },
  },
}