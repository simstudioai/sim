import type {
  PineconeIndexModel,
  PineconeListIndexesParams,
  PineconeResponse,
} from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

/** Map a raw Pinecone index model to a clean output shape. */
function mapIndex(index: any): PineconeIndexModel {
  return {
    name: index.name,
    dimension: index.dimension ?? null,
    metric: index.metric ?? null,
    host: index.host ?? null,
    vectorType: index.vector_type ?? null,
    deletionProtection: index.deletion_protection ?? null,
    tags: index.tags ?? null,
    spec: index.spec ?? null,
    status: index.status ?? null,
  }
}

export const listIndexesTool: ToolConfig<PineconeListIndexesParams, PineconeResponse> = {
  id: 'pinecone_list_indexes',
  name: 'Pinecone List Indexes',
  description: 'List all Pinecone indexes in the project',
  version: '1.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Pinecone API key',
    },
  },

  request: {
    method: 'GET',
    url: () => 'https://api.pinecone.io/indexes',
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
        indexes: (data.indexes ?? []).map(mapIndex),
      },
    }
  },

  outputs: {
    indexes: {
      type: 'array',
      description: 'List of indexes with name, dimension, metric, host, spec, and status',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Index name' },
          dimension: { type: 'number', description: 'Vector dimensionality' },
          metric: {
            type: 'string',
            description: 'Distance metric (cosine, euclidean, dotproduct)',
          },
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
  },
}
