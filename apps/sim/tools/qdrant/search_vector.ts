import type { QdrantResponse, QdrantSearchParams } from '@/tools/qdrant/types'
import {
  QDRANT_RESPONSE_OUTPUT_PROPERTIES,
  SCORED_POINT_OUTPUT_PROPERTIES,
} from '@/tools/qdrant/types'
import type { ToolConfig } from '@/tools/types'

export const searchVectorTool: ToolConfig<QdrantSearchParams, QdrantResponse> = {
  id: 'qdrant_search_vector',
  name: 'Qdrant Search Vector',
  description: 'Search for similar vectors in a Qdrant collection',
  version: '1.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Qdrant instance URL (e.g., https://your-cluster.qdrant.io)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Qdrant API key for authentication',
    },
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Collection name to search (e.g., "my_collection")',
    },
    vector: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Query vector for similarity search (e.g., [0.1, 0.2, 0.3, ...])',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10)',
    },
    filter: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Qdrant filter object (e.g., {"must": [{"key": "field", "match": {"value": "val"}}]})',
    },
    search_return_data: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Data to return from search',
    },
    with_payload: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include payload in response',
    },
    with_vector: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include vector in response',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `${params.url.replace(/\/$/, '')}/collections/${encodeURIComponent(params.collection)}/points/query`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...(params.apiKey ? { 'api-key': params.apiKey } : {}),
    }),
    body: (params) => {
      // Calculate with_payload and with_vector from search_return_data if provided
      let withPayload = params.with_payload ?? false
      let withVector = params.with_vector ?? false

      if (params.search_return_data) {
        switch (params.search_return_data) {
          case 'payload_only':
            withPayload = true
            withVector = false
            break
          case 'vector_only':
            withPayload = false
            withVector = true
            break
          case 'both':
            withPayload = true
            withVector = true
            break
          case 'none':
            withPayload = false
            withVector = false
            break
        }
      }

      return {
        query: params.vector,
        limit: params.limit ? Number(params.limit) : 10,
        filter: params.filter,
        with_payload: withPayload,
        with_vector: withVector,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        data: data.result,
        status: data.status,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Vector search results with ID, score, payload, and optional vector data',
      items: {
        type: 'object',
        properties: SCORED_POINT_OUTPUT_PROPERTIES,
      },
    },
    status: QDRANT_RESPONSE_OUTPUT_PROPERTIES.status,
  },
}
