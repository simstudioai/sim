import type { ToolConfig } from '../types'
import type {
  HuggingFaceChatParams,
  HuggingFaceChatResponse,
  HuggingFaceMessage,
  HuggingFaceRequestBody,
} from './types'

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

  transformResponse: async (response, params) => {
    try {
      // Check if the response was successful
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Hugging Face API error:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          url: response.url,
        })

        const errorMessage = errorData
          ? `API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
          : `API error: ${response.status} ${response.statusText}`

        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Validate response structure
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error('Invalid Hugging Face response format:', data)
        throw new Error('Invalid response format from Hugging Face API')
      }

      return {
        success: true,
        output: {
          content: data.choices[0].message.content,
          model: data.model || params?.model || 'unknown',
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
    } catch (error: any) {
      console.error('Failed to process Hugging Face response:', error)
      throw error
    }
  },

  transformError: (error) => {
    let errorMessage = 'Unknown error occurred'

    if (error) {
      if (typeof error === 'string') {
        errorMessage = error
      } else if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      } else {
        try {
          errorMessage = JSON.stringify(error)
        } catch (e) {
          errorMessage = 'Error occurred but could not be serialized'
        }
      }
    }

    return `Hugging Face chat completion failed: ${errorMessage}`
  },
}
