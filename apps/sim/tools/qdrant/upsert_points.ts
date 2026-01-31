import type { QdrantResponse, QdrantUpsertParams } from '@/tools/qdrant/types'
import {
  QDRANT_RESPONSE_OUTPUT_PROPERTIES,
  UPSERT_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/qdrant/types'
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
      description: 'Collection name for upsert (e.g., "my_collection")',
    },
    points: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of points to upsert',
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

  outputs: {
    status: QDRANT_RESPONSE_OUTPUT_PROPERTIES.status,
    data: {
      type: 'object',
      description: 'Result data from the upsert operation',
      properties: UPSERT_RESULT_OUTPUT_PROPERTIES,
    },
  },
}
