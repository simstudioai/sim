import type { ToolConfig } from '../types'
import type { QdrantResponse, QdrantSearchParams } from './types'

export const searchVectorTool: ToolConfig<QdrantSearchParams, QdrantResponse> = {
  id: 'qdrant_search',
  name: 'Qdrant Search Vector',
  description: 'Search for similar vectors in a Qdrant collection',
  version: '1.0',

  params: {
    url: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
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
      requiredForToolCall: true,
      description: 'Collection name',
    },
    vector: {
      type: 'array',
      required: true,
      description: 'Vector to search for',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Number of results to return',
    },
    filter: {
      type: 'object',
      required: false,
      description: 'Filter to apply to the search',
    },
    with_payload: {
      type: 'boolean',
      required: false,
      description: 'Include payload in response',
    },
    with_vector: {
      type: 'boolean',
      required: false,
      description: 'Include vector in response',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `${params.url.replace(/\/$/, '')}/collections/${params.collection}/points/query`,
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
    const data = await response.json()
    return {
      success: true,
      output: {
        data: data.result,
        status: data.status,
      },
    }
  },
}
