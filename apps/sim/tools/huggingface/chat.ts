import type {
  HuggingFaceChatParams,
  HuggingFaceChatResponse,
  HuggingFaceMessage,
  HuggingFaceRequestBody,
} from '@/tools/huggingface/types'
import type { ToolConfig } from '@/tools/types'

export const chatTool: ToolConfig<HuggingFaceChatParams, HuggingFaceChatResponse> = {
  id: 'huggingface_chat',
  name: 'Hugging Face Chat',
  description: 'Generate completions using Hugging Face Inference API',
  version: '1.0',

  params: {
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'System prompt to guide the model behavior',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message content to send to the model',
    },
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The provider to use for the API request (e.g., novita, cerebras, etc.)',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Model to use for chat completions (e.g., deepseek/deepseek-v3-0324)',
    },
    maxTokens: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of tokens to generate',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Sampling temperature (0-2). Higher values make output more random',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hugging Face API token',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      // Provider-specific endpoint mapping
      const endpointMap: Record<string, string> = {
        novita: '/v3/openai/chat/completions',
        cerebras: '/v1/chat/completions',
        cohere: '/v1/chat/completions',
        fal: '/v1/chat/completions',
        fireworks: '/v1/chat/completions',
        hyperbolic: '/v1/chat/completions',
        'hf-inference': '/v1/chat/completions',
        nebius: '/v1/chat/completions',
        nscale: '/v1/chat/completions',
        replicate: '/v1/chat/completions',
        sambanova: '/v1/chat/completions',
        together: '/v1/chat/completions',
      }

      const endpoint = endpointMap[params.provider] || '/v1/chat/completions'
      return `https://router.huggingface.co/${params.provider}${endpoint}`
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const messages: HuggingFaceMessage[] = []

      // Add system prompt if provided
      if (params.systemPrompt) {
        messages.push({
          role: 'system',
          content: params.systemPrompt,
        })
      }

      // Add user message
      messages.push({
        role: 'user',
        content: params.content,
      })

      const body: HuggingFaceRequestBody = {
        model: params.model,
        messages: messages,
        stream: false,
      }

      // Add optional parameters if provided
      if (params.temperature !== undefined) {
        body.temperature = Number(params.temperature)
      }

      if (params.maxTokens !== undefined) {
        body.max_tokens = Number(params.maxTokens)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || 'unknown',
        usage: data.usage
          ? {
              prompt_tokens: data.usage.prompt_tokens || 0,
              completion_tokens: data.usage.completion_tokens || 0,
              total_tokens: data.usage.total_tokens || 0,
            }
          : {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Chat completion results',
      properties: {
        content: { type: 'string', description: 'Generated text content' },
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
    },
  },
}
