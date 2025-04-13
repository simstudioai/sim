import { ToolConfig } from '../types'

interface OpenAIEmbeddingsParams {
  apiKey: string
  input: string | string[]
  model?: string
  encoding_format?: 'float' | 'base64'
  user?: string
}

export const embeddingsTool: ToolConfig<OpenAIEmbeddingsParams> = {
  id: 'openai_embeddings',
  name: 'OpenAI Embeddings',
  description: "Generate embeddings from text using OpenAI's embedding models",
  version: '1.0',

  params: {
    apiKey: { type: 'string', required: true, description: 'OpenAI API key' },
    input: {
      type: 'string',
      required: true,
      description: 'Text to generate embeddings for',
    },
    model: {
      type: 'string',
      required: false,
      description: 'Model to use for embeddings',
      default: 'text-embedding-3-small',
    },
    encoding_format: {
      type: 'string',
      required: false,
      description: 'The format to return the embeddings in',
      default: 'float',
    },
    user: {
      type: 'string',
      required: false,
      description: 'A unique identifier for the end-user',
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
      encoding_format: params.encoding_format || 'float',
      user: params.user,
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
