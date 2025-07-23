import type { ToolConfig } from '../types'
import type { QdrantFetchParams, QdrantResponse } from './types'

export const fetchPointsTool: ToolConfig<QdrantFetchParams, QdrantResponse> = {
  id: 'qdrant_fetch_points',
  name: 'Qdrant Fetch Points',
  description: 'Fetch points by ID from a Qdrant collection',
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
    ids: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of point IDs to fetch',
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
    url: (params) => `${params.url.replace(/\/$/, '')}/collections/${params.collection}/points`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...(params.apiKey ? { 'api-key': params.apiKey } : {}),
    }),
    body: (params) => ({
      ids: params.ids,
      with_payload: params.with_payload,
      with_vector: params.with_vector,
    }),
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
    return 'Qdrant fetch points failed'
  },
}
