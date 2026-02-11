import type { QdrantFetchParams, QdrantResponse } from '@/tools/qdrant/types'
import { POINT_OUTPUT_PROPERTIES, QDRANT_RESPONSE_OUTPUT_PROPERTIES } from '@/tools/qdrant/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Collection name to fetch from (e.g., "my_collection")',
    },
    ids: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of point IDs to fetch (e.g., ["id1", "id2"] or [1, 2])',
    },
    fetch_return_data: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Data to return from fetch',
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
    body: (params) => {
      // Calculate with_payload and with_vector from fetch_return_data if provided
      let withPayload = params.with_payload ?? false
      let withVector = params.with_vector ?? false

      if (params.fetch_return_data) {
        switch (params.fetch_return_data) {
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
        ids: params.ids,
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
      description: 'Fetched points with ID, payload, and optional vector data',
      items: {
        type: 'object',
        properties: POINT_OUTPUT_PROPERTIES,
      },
    },
    status: QDRANT_RESPONSE_OUTPUT_PROPERTIES.status,
  },
}
