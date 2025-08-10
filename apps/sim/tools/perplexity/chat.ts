import type { PerplexityChatParams, PerplexityChatResponse } from '@/tools/perplexity/types'
import type { ToolConfig } from '@/tools/types'

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
    const data = await response.json()
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
