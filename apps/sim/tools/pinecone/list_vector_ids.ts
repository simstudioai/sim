import type { PineconeListVectorIdsParams, PineconeResponse } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const listVectorIdsTool: ToolConfig<PineconeListVectorIdsParams, PineconeResponse> = {
  id: 'pinecone_list_vector_ids',
  name: 'Pinecone List Vector IDs',
  description: 'List vector IDs in a Pinecone namespace by prefix (serverless indexes only)',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Namespace to list vector IDs from (e.g., "documents", "embeddings")',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter vector IDs by a common prefix (e.g., "doc1#")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of IDs to return per page (default 100)',
    },
    paginationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response to fetch the next page',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Pinecone API key',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('namespace', params.namespace)
      if (params.prefix) {
        queryParams.append('prefix', params.prefix)
      }
      if (params.limit != null && String(params.limit) !== '') {
        queryParams.append('limit', String(params.limit))
      }
      if (params.paginationToken) {
        queryParams.append('paginationToken', params.paginationToken)
      }
      return `${params.indexHost}/vectors/list?${queryParams.toString()}`
    },
    headers: (params) => ({
      'Api-Key': params.apiKey,
      Accept: 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        vectorIds: (data.vectors ?? []).map((vector: { id: string }) => vector.id),
        pagination: data.pagination ?? null,
        namespace: data.namespace ?? null,
        usage: {
          total_tokens: data.usage?.readUnits ?? 0,
        },
      },
    }
  },

  outputs: {
    vectorIds: {
      type: 'array',
      description: 'Vector IDs in the namespace',
      items: { type: 'string', description: 'Vector ID' },
    },
    pagination: {
      type: 'object',
      description: 'Pagination info with a next token when more results exist',
      properties: {
        next: { type: 'string', description: 'Token to fetch the next page' },
      },
    },
    namespace: {
      type: 'string',
      description: 'Namespace the IDs were listed from',
    },
    usage: {
      type: 'object',
      description: 'Usage statistics including read units',
      properties: {
        total_tokens: { type: 'number', description: 'Read units consumed' },
      },
    },
  },
}
