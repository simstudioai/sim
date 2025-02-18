import { ToolConfig } from '../types'
import { PineconeFetchParams, PineconeResponse } from './types'

export const fetchTool: ToolConfig<PineconeFetchParams, PineconeResponse> = {
  id: 'pinecone_fetch',
  name: 'Pinecone Fetch',
  description: 'Fetch vectors by ID from a Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    ids: { type: 'array', required: true, description: 'Array of vector IDs to fetch' },
    namespace: { type: 'string', required: false, description: 'Namespace to fetch vectors from' },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const baseUrl = `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/vectors/fetch`
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
    return {
      success: true,
      output: {
        matches: Object.entries(data.vectors).map(([id, vector]: [string, any]) => ({
          id,
          score: 1.0, // Fetch doesn't return scores, so we use 1.0 for exact matches
          values: vector.values,
          metadata: vector.metadata,
        })),
      },
    }
  },

  transformError: (error) => `Pinecone fetch failed: ${error.message}`,
}
