import { ToolConfig } from '../types'
import { PineconeParams, PineconeResponse } from './types'

export const queryTool: ToolConfig<PineconeParams, PineconeResponse> = {
  id: 'pinecone_query',
  name: 'Pinecone Query',
  description: 'Query vectors from Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    queryVector: { type: 'array', required: true, description: 'Vector to query' },
    topK: {
      type: 'number',
      required: false,
      default: 10,
      description: 'Number of results to return',
    },
    includeMetadata: {
      type: 'boolean',
      required: false,
      default: true,
      description: 'Include metadata in results',
    },
    includeValues: {
      type: 'boolean',
      required: false,
      default: false,
      description: 'Include vector values in results',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/vectors/query`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      vector: params.queryVector,
      topK: params.topK || 10,
      includeMetadata: params.includeMetadata ?? true,
      includeValues: params.includeValues ?? false,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        matches: data.matches || [],
      },
    }
  },

  transformError: (error) => `Pinecone query failed: ${error.message}`,
}
