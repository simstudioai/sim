import type { PineconeDescribeIndexStatsParams, PineconeResponse } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const describeIndexStatsTool: ToolConfig<
  PineconeDescribeIndexStatsParams,
  PineconeResponse
> = {
  id: 'pinecone_describe_index_stats',
  name: 'Pinecone Describe Index Stats',
  description: 'Get statistics about a Pinecone index, including per-namespace vector counts',
  version: '1.0',

  params: {
    indexHost: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full Pinecone index host URL (e.g., "https://my-index-abc123.svc.pinecone.io")',
    },
    filter: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Metadata filter to limit which vectors are counted (pod-based indexes only, e.g., {"category": {"$eq": "product"}})',
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
    url: (params) => `${params.indexHost}/describe_index_stats`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.filter != null && params.filter !== '') {
        body.filter = typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        namespaces: data.namespaces ?? {},
        dimension: data.dimension ?? null,
        indexFullness: data.indexFullness ?? null,
        totalVectorCount: data.totalVectorCount ?? null,
      },
    }
  },

  outputs: {
    namespaces: {
      type: 'json',
      description: 'Map of namespace name to its summary including vectorCount',
    },
    dimension: {
      type: 'number',
      description: 'Dimensionality of the indexed vectors',
    },
    indexFullness: {
      type: 'number',
      description: 'Fullness of the index (pod-based indexes only)',
    },
    totalVectorCount: {
      type: 'number',
      description: 'Total number of vectors across all namespaces',
    },
  },
}
