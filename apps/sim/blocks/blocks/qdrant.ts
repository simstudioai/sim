import { QdrantIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { QdrantResponse } from '@/tools/qdrant/types'

export const QdrantBlock: BlockConfig<QdrantResponse> = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Use Qdrant vector database',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Qdrant into the workflow. Can upsert, search, and fetch points.',
  docsLink: 'https://qdrant.tech/documentation/',
  category: 'tools',
  integrationType: IntegrationType.Databases,
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

export const QdrantBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://qdrant.tech',
  templates: [
    {
      icon: QdrantIcon,
      title: 'Qdrant document ingestion',
      prompt:
        'Build a workflow that watches a Google Drive folder for new docs, chunks each, generates embeddings, and upserts the vectors into a Qdrant collection with rich metadata.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['google_drive', 'openai'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant retrieval agent',
      prompt:
        'Create an agent that performs hybrid search against a Qdrant collection — semantic + filter conditions — and answers user questions with the matched documents cited.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant payload schema migrator',
      prompt:
        'Build a workflow that scans a Qdrant collection, migrates payload schema to a new version with backfilled fields, and writes the migration plan and outcome to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant + knowledge base sync',
      prompt:
        'Create a workflow that mirrors a Sim knowledge base into a Qdrant collection so downstream applications outside Sim can perform retrieval against the same vectors.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant snapshot manager',
      prompt:
        'Build a scheduled workflow that takes a Qdrant collection snapshot each night, uploads it to S3 with retention rotation, and writes the snapshot manifest to a tracking table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant abandoned-document detector',
      prompt:
        'Create a workflow that scans a Qdrant collection for vectors whose source document no longer exists, deletes the orphans, and writes a hygiene report each week.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant support-answer retriever',
      prompt:
        'Build a workflow that embeds each new Zendesk ticket with OpenAI, runs a filtered Qdrant search scoped to the customer’s product, and drafts a cited reply from the closest matching resolved tickets for the agent to approve.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'vector-search', 'automation'],
      alsoIntegrations: ['openai', 'zendesk'],
    },
  ],
  skills: [
    {
      name: 'upsert-points',
      description: 'Insert or update vector points with payload metadata into a Qdrant collection.',
      content:
        '# Upsert Points\n\nLoad vectors into a Qdrant collection.\n\n## Steps\n1. Use the Upsert operation with the Qdrant URL, Collection name, and API Key.\n2. Provide Points as a JSON array, each with an id, a vector matching the collection dimension, and an optional payload of metadata for later filtering.\n3. Confirm the upserted count from the response.\n\n## Output\nReport how many points were upserted into which collection and surface any payload validation issues.',
    },
    {
      name: 'search-vectors',
      description: 'Run a vector similarity search in Qdrant with optional payload filters.',
      content:
        '# Search Vectors\n\nFind the nearest points to a query vector.\n\n## Steps\n1. Use the Search operation with the Qdrant URL, Collection, and the Query Vector.\n2. Set the Limit for how many matches to return and choose what Return Data you need (payload only, vector only, both, or none).\n3. Optionally pass a Filter JSON object using must, should, or must_not conditions to scope the search by payload fields.\n\n## Output\nThe top matches with their scores and requested payload or vector data, ordered by similarity.',
    },
    {
      name: 'fetch-points-by-id',
      description: 'Retrieve specific Qdrant points and their payloads by ID.',
      content:
        '# Fetch Points By ID\n\nLook up known points directly.\n\n## Steps\n1. Use the Fetch operation with the Qdrant URL, Collection, and API Key.\n2. Provide the IDs as a JSON array of the points to retrieve.\n3. Choose the Return Data option to control whether payloads and vectors are included.\n\n## Output\nThe requested points with their payloads (and vectors if requested), plus a note on any IDs that were not found.',
    },
  ],
} as const satisfies BlockMeta
