import { ToolConfig } from '../types'
import { PineconeResponse, PineconeSearchTextParams } from './types'

export const searchTextTool: ToolConfig<PineconeSearchTextParams, PineconeResponse> = {
  id: 'pinecone_search_text',
  name: 'Pinecone Search Text',
  description: 'Search for similar text in a Pinecone index',
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
    namespace: { type: 'string', required: false, description: 'Namespace to search in' },
    query: {
      type: 'object',
      required: true,
      description: 'Query parameters including text input and top_k',
    },
    fields: {
      type: 'array',
      required: false,
      description: 'Fields to return in the search results',
    },
    rerank: {
      type: 'object',
      required: false,
      description: 'Parameters for reranking the initial search results',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://${params.indexName}-${params.environment}.svc.${params.environment}.pinecone.io/records/namespaces/${params.namespace || ''}/search`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      query: params.query,
      fields: params.fields,
      rerank: params.rerank,
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
          metadata: match.metadata,
          values: match.values,
        })),
      },
    }
  },

  transformError: (error) => `Pinecone text search failed: ${error.message}`,
}
