import type { PineconeFetchParams, PineconeResponse, PineconeVector } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const fetchTool: ToolConfig<PineconeFetchParams, PineconeResponse> = {
  id: 'pinecone_fetch',
  name: 'Pinecone Fetch',
  description: 'Fetch vectors by ID from a Pinecone index',
  version: '1.0',

  params: {
    indexHost: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Full Pinecone index host URL',
    },
    ids: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Array of vector IDs to fetch',
    },
    namespace: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Namespace to fetch vectors from',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Pinecone API key',
    },
  },

  outputs: {
    matches: {
      type: 'array',
      description: 'Fetched vectors with ID, values, metadata, and score',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Vector ID' },
          values: { type: 'array', description: 'Vector values' },
          metadata: { type: 'object', description: 'Associated metadata' },
          score: { type: 'number', description: 'Match score (1.0 for exact matches)' },
        },
      },
    },
    data: {
      type: 'array',
      description: 'Vector data with values and vector type',
      items: {
        type: 'object',
        properties: {
          values: { type: 'array', description: 'Vector values' },
          vector_type: { type: 'string', description: 'Vector type (dense/sparse)' },
        },
      },
    },
    usage: {
      type: 'object',
      description: 'Usage statistics including total read units',
      properties: {
        total_tokens: { type: 'number', description: 'Read units consumed' },
      },
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const baseUrl = `${params.indexHost}/vectors/fetch`
      const queryParams = new URLSearchParams()
      queryParams.append('ids', params.ids.join(','))
      if (params.namespace) {
        queryParams.append('namespace', params.namespace)
      }
      return `${baseUrl}?${queryParams.toString()}`
    },
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const vectors = data.vectors as Record<string, PineconeVector>

    return {
      success: true,
      output: {
        matches: Object.entries(vectors).map(([id, vector]) => ({
          id,
          values: vector.values,
          metadata: vector.metadata,
          score: 1.0, // Fetch returns exact matches
        })),
        data: Object.values(vectors).map((vector) => ({
          values: vector.values,
          vector_type: 'dense' as const,
        })),
        usage: {
          total_tokens: data.usage?.readUnits || 0,
        },
      },
    }
  },

  transformError: (error) => `Pinecone fetch failed: ${error.message}`,
}
