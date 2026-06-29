import type {
  PineconeDescribeIndexParams,
  PineconeIndexModel,
  PineconeResponse,
} from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const describeIndexTool: ToolConfig<PineconeDescribeIndexParams, PineconeResponse> = {
  id: 'pinecone_describe_index',
  name: 'Pinecone Describe Index',
  description: 'Get the configuration and status of a Pinecone index by name',
  version: '1.0',

  params: {
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the index to describe',
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
    url: (params) =>
      `https://api.pinecone.io/indexes/${encodeURIComponent(params.indexName.trim())}`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      Accept: 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const index: PineconeIndexModel = {
      name: data.name,
      dimension: data.dimension ?? null,
      metric: data.metric ?? null,
      host: data.host ?? null,
      vectorType: data.vector_type ?? null,
      deletionProtection: data.deletion_protection ?? null,
      tags: data.tags ?? null,
      spec: data.spec ?? null,
      status: data.status ?? null,
    }
    return {
      success: true,
      output: { index },
    }
  },

  outputs: {
    index: {
      type: 'object',
      description: 'Index configuration and status',
      properties: {
        name: { type: 'string', description: 'Index name' },
        dimension: { type: 'number', description: 'Vector dimensionality' },
        metric: { type: 'string', description: 'Distance metric (cosine, euclidean, dotproduct)' },
        host: { type: 'string', description: 'Index host URL for data-plane operations' },
        vectorType: { type: 'string', description: 'Vector type (dense or sparse)' },
        deletionProtection: {
          type: 'string',
          description: 'Deletion protection (enabled or disabled)',
        },
        tags: { type: 'object', description: 'Custom user tags on the index' },
        spec: { type: 'object', description: 'Index spec (serverless or pod configuration)' },
        status: { type: 'object', description: 'Index status with ready and state' },
      },
    },
  },
}
