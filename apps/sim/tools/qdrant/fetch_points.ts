import type { QdrantFetchParams, QdrantResponse } from '@/tools/qdrant/types'
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
    },
    status: {
      type: 'string',
      description: 'Status of the fetch operation',
    },
  },
}
