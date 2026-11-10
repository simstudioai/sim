import type { PineconeResponse, PineconeUpdateVectorParams } from '@/tools/pinecone/types'
import { parseJsonParam } from '@/tools/pinecone/utils'
import type { ToolConfig } from '@/tools/types'

export const updateVectorTool: ToolConfig<PineconeUpdateVectorParams, PineconeResponse> = {
  id: 'pinecone_update_vector',
  name: 'Pinecone Update Vector',
  description: 'Update the values, sparse values, or metadata of a vector in a Pinecone namespace',
  version: '1.0',

  params: {
    indexHost: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full Pinecone index host URL (e.g., "https://my-index-abc123.svc.pinecone.io")',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the vector to update',
    },
    namespace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Namespace containing the vector (e.g., "documents", "embeddings")',
    },
    values: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New dense vector values to overwrite the existing values',
    },
    sparseValues: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'New sparse vector values with indices and values arrays',
    },
    setMetadata: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Metadata key-value pairs to add or overwrite on the vector',
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
    url: (params) => `${params.indexHost}/vectors/update`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { id: params.id.trim() }
      if (params.namespace) {
        body.namespace = params.namespace
      }
      if (params.values != null && params.values !== '') {
        body.values = parseJsonParam(params.values, 'values')
      }
      if (params.sparseValues != null && params.sparseValues !== '') {
        body.sparseValues = parseJsonParam(params.sparseValues, 'sparseValues')
      }
      if (params.setMetadata != null && params.setMetadata !== '') {
        body.setMetadata = parseJsonParam(params.setMetadata, 'setMetadata')
      }
      return body
    },
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        statusText: response.status === 200 ? 'Updated' : response.statusText,
      },
    }
  },

  outputs: {
    statusText: {
      type: 'string',
      description: 'Status of the update operation',
    },
  },
}
