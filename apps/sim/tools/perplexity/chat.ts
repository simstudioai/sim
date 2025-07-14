import type { ToolConfig } from '../types'
import type { PerplexityChatParams, PerplexityChatResponse } from './types'

export const chatTool: ToolConfig<PerplexityChatParams, PerplexityChatResponse> = {
  id: 'perplexity_chat',
  name: 'Perplexity Chat',
  description: 'Generate completions using Perplexity AI chat models',
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
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Model to use for chat completions (e.g., sonar, mistral)',
    },
    max_tokens: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of tokens to generate',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Sampling temperature between 0 and 1',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Perplexity API key',
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
      const messages: Array<{ role: string; content: string }> = []

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

      const body: Record<string, any> = {
        model: params.model,
        messages: messages,
      }

      // Add optional parameters if provided
      if (params.max_tokens !== undefined) {
        body.max_tokens = Number(params.max_tokens) || 10000
      }

      if (params.temperature !== undefined) {
        body.temperature = Number(params.temperature)
      }

      return body
    },
  },

  transformResponse: async (response) => {
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
