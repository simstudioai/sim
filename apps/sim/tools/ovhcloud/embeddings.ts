import type { OVHcloudEmbeddingsParams, OVHcloudEmbeddingsResponse } from '@/tools/ovhcloud/types'
import type { ToolConfig } from '@/tools/types'

export const embeddingsTool: ToolConfig<OVHcloudEmbeddingsParams, OVHcloudEmbeddingsResponse> = {
  id: 'ovhcloud_embeddings',
  name: 'OVHcloud AI Endpoints Embeddings',
  description: 'Generate embeddings using OVHcloud AI Endpoints models',
  version: '1.0',

  params: {
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Model to use for embeddings',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OVHcloud AI Endpoints API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/embeddings',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        model: params.model,
        input: params.input,
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        embedding: data.data[0].embedding,
        model: data.model,
        usage: {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
        },
      },
    }
  },

  outputs: {
    embedding: { type: 'string', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used for generation' },
    usage: {
      type: 'object',
      description: 'Token usage information',
      properties: {
        prompt_tokens: { type: 'number', description: 'Number of tokens in the prompt' },
        completion_tokens: {
          type: 'number',
          description: 'Number of tokens in the completion',
        },
        total_tokens: { type: 'number', description: 'Total number of tokens used' },
      },
    },
  },
}
