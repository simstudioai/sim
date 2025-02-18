import { ToolConfig } from '../types'
import { PineconeParams, PineconeResponse } from './types'

export const upsertTool: ToolConfig<PineconeParams, PineconeResponse> = {
  id: 'pinecone_upsert',
  name: 'Pinecone Upsert',
  description: 'Upsert vectors into Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    vectors: {
      type: 'array',
      required: true,
      description: 'Array of vectors to upsert, each with id, values, and optional metadata',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/vectors/upsert`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      vectors: params.vectors,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        upsertedCount: data.upsertedCount || 0,
      },
    }
  },

  transformError: (error) => `Pinecone upsert failed: ${error.message}`,
}
