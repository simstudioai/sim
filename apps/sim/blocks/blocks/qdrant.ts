import { QdrantIcon } from '@/components/icons'
import type { QdrantResponse } from '@/tools/qdrant/types'
import type { BlockConfig } from '../types'

export const QdrantBlock: BlockConfig<QdrantResponse> = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Use Qdrant vector database',
  longDescription:
    'Store, search, and retrieve vector embeddings using Qdrant. Perform semantic similarity searches and manage your vector collections.',
  docsLink: 'https://qdrant.tech/documentation/',
  category: 'tools',
  bgColor: '#1A223F',
  icon: QdrantIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Upsert', id: 'upsert' },
        { label: 'Search', id: 'search' },
        { label: 'Fetch', id: 'fetch' },
      ],
    },
    // Upsert fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'upsert' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Qdrant API key (optional)',
      password: true,
      condition: { field: 'operation', value: 'upsert' },
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'upsert' },
    },
    {
      id: 'points',
      title: 'Points',
      type: 'long-input',
      layout: 'full',
      placeholder: '[{"id": 1, "vector": [0.1, 0.2], "payload": {"category": "a"}}]',
      condition: { field: 'operation', value: 'upsert' },
    },
    // Search fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Qdrant API key (optional)',
      password: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'vector',
      title: 'Query Vector',
      type: 'long-input',
      layout: 'full',
      placeholder: '[0.1, 0.2]',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"must":[{"key":"city","match":{"value":"London"}}]}',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'with_payload',
      title: 'With Payload',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'with_vector',
      title: 'With Vector',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'search' },
    },
    // Fetch fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Qdrant API key (optional)',
      password: true,
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      layout: 'full',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'ids',
      title: 'IDs',
      type: 'long-input',
      layout: 'full',
      placeholder: '["370446a3-310f-58db-8ce7-31db947c6c1e"]',
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'with_payload',
      title: 'With Payload',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'with_vector',
      title: 'With Vector',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'fetch' },
    },
  ],

  tools: {
    access: ['qdrant_upsert_points', 'qdrant_search_vector', 'qdrant_fetch_points'],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'upsert':
            return 'qdrant_upsert_points'
          case 'search':
            return 'qdrant_search_vector'
          case 'fetch':
            return 'qdrant_fetch_points'
          default:
            throw new Error('Invalid operation selected')
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', required: true },
    url: { type: 'string', required: true },
    apiKey: { type: 'string', required: false },
    collection: { type: 'string', required: true },
    points: { type: 'json', required: false },
    vector: { type: 'json', required: false },
    limit: { type: 'number', required: false },
    filter: { type: 'json', required: false },
    ids: { type: 'json', required: false },
    with_payload: { type: 'boolean', required: false },
    with_vector: { type: 'boolean', required: false },
  },

  outputs: {
    matches: 'any',
    upsertedCount: 'any',
    data: 'any',
    status: 'any',
  },
}
