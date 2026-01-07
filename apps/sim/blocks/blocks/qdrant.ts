import { QdrantIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { QdrantResponse } from '@/tools/qdrant/types'

export const QdrantBlock: BlockConfig<QdrantResponse> = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Use Qdrant vector database',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Qdrant into the workflow. Can upsert, search, and fetch points.',
  docsLink: 'https://qdrant.tech/documentation/',
  category: 'tools',
  bgColor: '#1A223F',
  icon: QdrantIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Upsert', id: 'upsert' },
        { label: 'Search', id: 'search' },
        { label: 'Fetch', id: 'fetch' },
      ],
      value: () => 'upsert',
    },
    // Upsert fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
    },
    {
      id: 'points',
      title: 'Points',
      type: 'long-input',
      placeholder: '[{"id": 1, "vector": [0.1, 0.2], "payload": {"category": "a"}}]',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Qdrant points for vector database upsert based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each point must have: id (number or string UUID), vector (array of floats)
- Optional: payload (object with metadata)
- Vector dimensions must match the collection's configuration

### EXAMPLE
User: "Create 2 points for product embeddings with category and price"
Output:
[
  {"id": 1, "vector": [0.1, 0.2, 0.3], "payload": {"category": "electronics", "price": 299.99}},
  {"id": 2, "vector": [0.4, 0.5, 0.6], "payload": {"category": "clothing", "price": 49.99}}
]

Return ONLY the JSON array.`,
        placeholder: 'Describe the points to upsert...',
        generationType: 'json-object',
      },
    },
    // Search fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'search' },
      required: true,
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'search' },
      required: true,
    },
    {
      id: 'vector',
      title: 'Query Vector',
      type: 'long-input',
      placeholder: '[0.1, 0.2]',
      condition: { field: 'operation', value: 'search' },
      required: true,
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      placeholder: '{"must":[{"key":"city","match":{"value":"London"}}]}',
      condition: { field: 'operation', value: 'search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Qdrant filter JSON object based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Use Qdrant filter syntax with "must", "should", or "must_not" arrays
- Each condition has: key (field name), match/range/geo (condition type)
- Match types: value (exact), text (full-text), any (array contains)
- Range types: gt, gte, lt, lte

### EXAMPLE
User: "Filter for products in electronics category with price under 500"
Output:
{
  "must": [
    {"key": "category", "match": {"value": "electronics"}},
    {"key": "price", "range": {"lt": 500}}
  ]
}

Return ONLY the JSON object.`,
        placeholder: 'Describe the filter conditions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'search_return_data',
      title: 'Return Data',
      type: 'dropdown',
      options: [
        { label: 'Payload Only', id: 'payload_only' },
        { label: 'Vector Only', id: 'vector_only' },
        { label: 'Both Payload and Vector', id: 'both' },
        { label: 'None (IDs and scores only)', id: 'none' },
      ],
      value: () => 'payload_only',
      condition: { field: 'operation', value: 'search' },
    },
    // Fetch fields
    {
      id: 'url',
      title: 'Qdrant URL',
      type: 'short-input',
      placeholder: 'http://localhost:6333',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      placeholder: 'my-collection',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
    },
    {
      id: 'ids',
      title: 'IDs',
      type: 'long-input',
      placeholder: '["370446a3-310f-58db-8ce7-31db947c6c1e"]',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
    },
    {
      id: 'fetch_return_data',
      title: 'Return Data',
      type: 'dropdown',
      options: [
        { label: 'Payload Only', id: 'payload_only' },
        { label: 'Vector Only', id: 'vector_only' },
        { label: 'Both Payload and Vector', id: 'both' },
        { label: 'None (IDs only)', id: 'none' },
      ],
      value: () => 'payload_only',
      condition: { field: 'operation', value: 'fetch' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Your Qdrant API key (optional)',
      password: true,
      required: true,
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
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Qdrant server URL' },
    apiKey: { type: 'string', description: 'Qdrant API key' },
    collection: { type: 'string', description: 'Collection name' },
    points: { type: 'json', description: 'Points to upsert' },
    vector: { type: 'json', description: 'Query vector' },
    limit: { type: 'number', description: 'Result limit' },
    filter: { type: 'json', description: 'Search filter' },
    ids: { type: 'json', description: 'Point identifiers' },
    search_return_data: { type: 'string', description: 'Data to return from search' },
    fetch_return_data: { type: 'string', description: 'Data to return from fetch' },
    with_payload: { type: 'boolean', description: 'Include payload' },
    with_vector: { type: 'boolean', description: 'Include vectors' },
  },

  outputs: {
    matches: { type: 'json', description: 'Search matches' },
    upsertedCount: { type: 'number', description: 'Upserted count' },
    data: { type: 'json', description: 'Response data' },
    status: { type: 'string', description: 'Operation status' },
  },
}
