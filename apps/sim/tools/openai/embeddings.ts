import type { ToolConfig } from '../types'
import type { OpenAIEmbeddingsParams } from './types'

export const embeddingsTool: ToolConfig<OpenAIEmbeddingsParams> = {
  id: 'openai_embeddings',
  name: 'OpenAI Embeddings',
  description: "Generate embeddings from text using OpenAI's embedding models",
  version: '1.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to generate embeddings for',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Model to use for embeddings',
      default: 'text-embedding-3-small',
    },
    encodingFormat: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The format to return the embeddings in',
      default: 'float',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OpenAI API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.openai.com/v1/embeddings',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      input: params.input,
      model: params.model || 'text-embedding-3-small',
      encoding_format: params.encodingFormat || 'float',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        embeddings: data.data.map((item: any) => item.embedding),
        model: data.model,
        usage: {
          prompt_tokens: data.usage.prompt_tokens,
          total_tokens: data.usage.total_tokens,
        },
      },
    }
  },

  transformError: (error) => `OpenAI embeddings generation failed: ${error.message}`,
}
