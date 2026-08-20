import type { ToolConfig } from '../types'
import type { PerplexityChatParams, PerplexityChatResponse } from './types'

export const chatTool: ToolConfig<PerplexityChatParams, PerplexityChatResponse> = {
  id: 'perplexity_chat',
  name: 'Perplexity Chat',
  description: 'Generate completions using Perplexity AI chat models',
  version: '1.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Perplexity API key',
    },
    model: {
      type: 'string',
      required: true,
      description: 'Model to use for chat completions (e.g., sonar, mistral)',
    },
    messages: {
      type: 'array',
      required: true,
      description: 'Array of message objects with role and content',
    },
    max_tokens: {
      type: 'number',
      required: false,
      description: 'Maximum number of tokens to generate',
    },
    temperature: {
      type: 'number',
      required: false,
      description: 'Sampling temperature between 0 and 1',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.perplexity.ai/chat/completions',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let messages = params.messages

      if (!messages && (params.prompt || params.system)) {
        messages = []

        // Add system message if provided
        if (params.system && typeof params.system === 'string' && params.system.trim() !== '') {
          messages.push({
            role: 'system',
            content: params.system,
          })
        }

        // Add user message
        if (params.prompt && typeof params.prompt === 'string' && params.prompt.trim() !== '') {
          messages.push({
            role: 'user',
            content: params.prompt,
          })
        }
      }

      // Validate that each message has role and content
      for (const msg of messages!) {
        if (!msg.role || !msg.content) {
          throw new Error('Each message must have role and content properties')
        }
      }

      const body: Record<string, any> = {
        model: params.model,
        messages: messages,
      }

      if (params.max_tokens !== undefined) {
        body.max_tokens = params.max_tokens
      }

      if (params.temperature !== undefined) {
        body.temperature = params.temperature
      }

      return body
    },
  },

  transformResponse: async (response, params) => {
    try {
      // Check if the response was successful
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('Perplexity API error:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
        })

        const errorMessage = errorData
          ? JSON.stringify(errorData)
          : `API error: ${response.status} ${response.statusText}`

        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Validate response structure
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error('Invalid Perplexity response format:', data)
        throw new Error('Invalid response format from Perplexity API')
      }

      return {
        success: true,
        output: {
          content: data.choices[0].message.content,
          model: data.model,
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          },
        },
      }
    } catch (error: any) {
      console.error('Failed to process Perplexity response:', error)
      throw error
    }
  },

  transformError: (error) => `Perplexity chat completion failed: ${error.message}`,
}
