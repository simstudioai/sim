import type { ToolConfig } from '../types'
import type { PineconeResponse, PineconeSearchVectorParams } from './types'

export const searchVectorTool: ToolConfig<PineconeSearchVectorParams, PineconeResponse> = {
  id: 'pinecone_search_vector',
  name: 'Pinecone Search Vector',
  description: 'Search for similar vectors in a Pinecone index',
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
    namespace: {
      type: 'string',
      required: false,
      description: 'Namespace to search in',
    },
    vector: {
      type: 'array',
      required: true,
      description: 'Vector to search for',
    },
    topK: {
      type: 'number',
      required: false,
      description: 'Number of results to return',
    },
    filter: {
      type: 'object',
      required: false,
      description: 'Filter to apply to the search',
    },
    includeValues: {
      type: 'boolean',
      required: false,
      description: 'Include vector values in response',
    },
    includeMetadata: {
      type: 'boolean',
      required: false,
      description: 'Include metadata in response',
    },
  },

  request: {
    method: 'POST',
    url: (params) => `${params.indexHost}/query`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({
      namespace: params.namespace,
      vector: typeof params.vector === 'string' ? JSON.parse(params.vector) : params.vector,
      topK: params.topK ? Number.parseInt(params.topK.toString()) : 10,
      filter: params.filter
        ? typeof params.filter === 'string'
          ? JSON.parse(params.filter)
          : params.filter
        : undefined,
      includeValues: true, //TODO: Make this dynamic
      includeMetadata: true, //TODO: Make this dynamic
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        matches: data.matches.map((match: any) => ({
          id: match.id,
          score: match.score,
          values: match.values,
          metadata: match.metadata,
        })),
        namespace: data.namespace,
      },
    }
  },

  transformError: (error) => `Pinecone vector search failed: ${error.message}`,
}
