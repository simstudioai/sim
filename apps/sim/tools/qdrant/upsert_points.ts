import type { QdrantResponse, QdrantUpsertParams } from '@/tools/qdrant/types'
import type { ToolConfig } from '@/tools/types'

export const upsertPointsTool: ToolConfig<QdrantUpsertParams, QdrantResponse> = {
  id: 'qdrant_upsert_points',
  name: 'Qdrant Upsert Points',
  description: 'Insert or update points in a Qdrant collection',
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
      description: 'Qdrant API key (optional)',
    },
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Collection name',
    },
    points: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of points to upsert',
    },
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Status of the upsert operation',
    },
    data: {
      type: 'object',
      description: 'Result data from the upsert operation',
    },
  },

  request: {
    method: 'PUT',
    url: (params) => `${params.url.replace(/\/$/, '')}/collections/${params.collection}/points`,
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...(params.apiKey ? { 'api-key': params.apiKey } : {}),
    }),
    body: (params) => ({ points: params.points }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: response.ok && data.status === 'ok',
      output: {
        status: data.status,
        data: data.result,
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
    return 'Qdrant upsert failed'
  },
}
