import { ToolConfig } from '../types'
import { PineconeParams, PineconeResponse } from './types'

export const deleteTool: ToolConfig<PineconeParams, PineconeResponse> = {
  id: 'pinecone_delete',
  name: 'Pinecone Delete',
  description: 'Delete vectors from Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    ids: { type: 'array', required: false, description: 'Array of vector IDs to delete' },
    deleteAll: { type: 'boolean', required: false, description: 'Delete all vectors in the index' },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/vectors/delete`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      ids: params.ids,
      deleteAll: params.deleteAll,
    }),
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        deletedCount: response.ok ? 1 : 0, // Pinecone doesn't return count, so we estimate
      },
    }
  },

  transformError: (error) => `Pinecone delete failed: ${error.message}`,
}
