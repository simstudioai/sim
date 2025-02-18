import { ToolConfig } from '../types'
import { PineconeResponse, PineconeUpsertTextParams } from './types'

export const upsertTextTool: ToolConfig<PineconeUpsertTextParams, PineconeResponse> = {
  id: 'pinecone_upsert_text',
  name: 'Pinecone Upsert Text',
  description: 'Insert or update text records in a Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    namespace: { type: 'string', required: false, description: 'Namespace to upsert records into' },
    records: {
      type: 'array',
      required: true,
      description: 'Array of records to upsert, each containing _id, text, and optional metadata',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/records/namespaces/${params.namespace || ''}/upsert`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      records: params.records,
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

  transformError: (error) => `Pinecone text upsert failed: ${error.message}`,
}
