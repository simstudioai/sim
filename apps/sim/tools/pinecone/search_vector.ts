import type { PineconeResponse, PineconeSearchVectorParams } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const searchVectorTool: ToolConfig<PineconeSearchVectorParams, PineconeResponse> = {
  id: 'pinecone_search_vector',
  name: 'Pinecone Search Vector',
  description: 'Search for similar vectors in a Pinecone index',
  version: '1.0',

  params: {
    indexHost: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full Pinecone index host URL (e.g., "https://my-index-abc123.svc.pinecone.io")',
    },
    namespace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Namespace to search in (e.g., "documents", "embeddings")',
    },
    vector: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      description: 'Vector to search for',
    },
    topK: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 25)',
    },
    filter: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter to apply to the search (e.g., {"category": "tech", "year": {"$gte": 2020}})',
    },
    includeValues: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include vector values in response',
    },
    includeMetadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include metadata in response (true/false)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Pinecone API key',
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
      topK: params.topK ? Number(params.topK) : 10,
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

  outputs: {
    matches: {
      type: 'array',
      description: 'Vector search results with ID, score, values, and metadata',
    },
    namespace: {
      type: 'string',
      description: 'Namespace where the search was performed',
    },
  },
}
