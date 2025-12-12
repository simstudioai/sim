import type { QdrantResponse, QdrantSearchParams } from '@/tools/qdrant/types'
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
      description: 'Qdrant base URL',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Qdrant API key (optional)',
    },
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Collection name',
    },
    vector: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Vector to search for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return',
    },
    filter: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Filter to apply to the search',
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
    },
    status: {
      type: 'string',
      description: 'Status of the search operation',
    },
  },
}
