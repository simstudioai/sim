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

  request: {
    method: 'POST',
    url: (params) =>
      `${params.url.replace(/\/$/, '')}/collections/${encodeURIComponent(params.collection)}/points/query`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...(params.apiKey ? { 'api-key': params.apiKey } : {}),
    }),
    body: (params) => ({
      query: params.vector,
      limit: params.limit ? Number.parseInt(params.limit.toString()) : 10,
      filter: params.filter,
      with_payload: params.with_payload,
      with_vector: params.with_vector,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(`Qdrant search failed: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        data: data.result,
        status: data.status,
      },
    }
  },

  transformError: (error: any): string => {
    if (error.error && typeof error.error === 'string') {
      return error.error
    }
    if (error.status?.error) {
      return error.status.error
    }
    if (error.message) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    return 'Qdrant search vector failed'
  },
}
