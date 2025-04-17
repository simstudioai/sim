import { ToolConfig } from '../types'
import { PineconeFetchParams, PineconeResponse, PineconeVector } from './types'

export const fetchTool: ToolConfig<PineconeFetchParams, PineconeResponse> = {
  id: 'pinecone_fetch',
  name: 'Pinecone Fetch',
  description: 'Fetch vectors by ID from a Pinecone index',
  version: '1.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Pinecone API key',
    },
    indexHost: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Full Pinecone index host URL',
    },
    ids: {
      type: 'array',
      required: true,
      requiredForToolCall: true,
      description: 'Array of vector IDs to fetch',
    },
    namespace: {
      type: 'string',
      required: false,
      description: 'Namespace to fetch vectors from',
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
