import type { PineconeDeleteVectorsParams, PineconeResponse } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const deleteVectorsTool: ToolConfig<PineconeDeleteVectorsParams, PineconeResponse> = {
  id: 'pinecone_delete_vectors',
  name: 'Pinecone Delete Vectors',
  description: 'Delete vectors from a Pinecone namespace by IDs, by metadata filter, or delete all',
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
      description: 'Namespace to delete vectors from (e.g., "documents", "embeddings")',
    },
    ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Vector IDs to delete (1-1000 items). Mutually exclusive with deleteAll and filter',
    },
    deleteAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete all vectors in the namespace. Mutually exclusive with ids and filter',
    },
    filter: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Metadata filter selecting vectors to delete (e.g., {"category": {"$eq": "product"}}). Mutually exclusive with ids and deleteAll',
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
    url: (params) => `${params.indexHost}/vectors/delete`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.namespace) {
        body.namespace = params.namespace
      }
      if (params.ids != null && params.ids !== '') {
        const ids = typeof params.ids === 'string' ? JSON.parse(params.ids) : params.ids
        if (Array.isArray(ids) && ids.length > 0) {
          body.ids = ids
        }
      }
      if (params.deleteAll === true || params.deleteAll === 'true') {
        body.deleteAll = true
      }
      if (params.filter != null && params.filter !== '') {
        body.filter = typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter
      }
      return body
    },
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        statusText: response.status === 200 ? 'Deleted' : response.statusText,
      },
    }
  },

  outputs: {
    statusText: {
      type: 'string',
      description: 'Status of the delete operation',
    },
  },
}
