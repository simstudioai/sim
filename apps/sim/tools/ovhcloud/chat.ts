import type { OVHcloudChatParams, OVHcloudChatResponse } from '@/tools/ovhcloud/types'
import type { ToolConfig } from '@/tools/types'

export const chatTool: ToolConfig<OVHcloudChatParams, OVHcloudChatResponse> = {
  id: 'ovhcloud_chat',
  name: 'OVHcloud AI Endpoints Chat',
  description: 'Generate completions using OVHcloud AI Endpoints LLM models',
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
      description: 'Model to use for chat completions (e.g., gpt-oss-120b, llama@latest)',
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
      description: 'OVHcloud AI Endpoints API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
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
}
