import type { VoyageAIEmbeddingsParams, VoyageAIEmbeddingsResponse } from '@/tools/voyageai/types'
import type { ToolConfig } from '@/tools/types'

export const embeddingsTool: ToolConfig<VoyageAIEmbeddingsParams, VoyageAIEmbeddingsResponse> = {
  id: 'voyageai_embeddings',
  name: 'Voyage AI Embeddings',
  description: 'Generate embeddings from text using Voyage AI embedding models',
  version: '1.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text or array of texts to generate embeddings for',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Embedding model to use',
      default: 'voyage-3',
    },
    inputType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Type of input: "query" for search queries, "document" for documents to be indexed',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Voyage AI API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.voyageai.com/v1/embeddings',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        input: Array.isArray(params.input) ? params.input : [params.input],
        model: params.model || 'voyage-3',
      }
      if (params.inputType) {
        body.input_type = params.inputType
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        embeddings: data.data.map((item: { embedding: number[] }) => item.embedding),
        model: data.model,
        usage: {
          total_tokens: data.usage.total_tokens,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Embeddings generation results',
      properties: {
        embeddings: { type: 'array', description: 'Array of embedding vectors' },
        model: { type: 'string', description: 'Model used for generating embeddings' },
        usage: {
          type: 'object',
          description: 'Token usage information',
          properties: {
            total_tokens: { type: 'number', description: 'Total number of tokens used' },
          },
        },
      },
    },
  },
}
