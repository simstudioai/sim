import type { PineconeGenerateEmbeddingsParams, PineconeResponse } from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const generateEmbeddingsTool: ToolConfig<
  PineconeGenerateEmbeddingsParams,
  PineconeResponse
> = {
  id: 'pinecone_generate_embeddings',
  name: 'Pinecone Generate Embeddings',
  description: "Generate embeddings from text using Pinecone's hosted models",
  version: '1.0',

  params: {
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Model to use for generating embeddings',
    },
    inputs: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of text inputs to generate embeddings for',
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
    url: () => 'https://api.pinecone.io/embed',
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => ({
      model: params.model,
      inputs: params.inputs,
      parameters: params.parameters || {
        input_type: 'passage',
        truncate: 'END',
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        data: data.data,
        model: data.model,
        vector_type: data.vector_type,
        usage: data.usage,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Generated embeddings data with values and vector type',
    },
    model: {
      type: 'string',
      description: 'Model used for generating embeddings',
    },
    vector_type: {
      type: 'string',
      description: 'Type of vector generated (dense/sparse)',
    },
    usage: {
      type: 'object',
      description: 'Usage statistics for embeddings generation',
    },
  },
}
