import { ToolConfig, ToolResponse } from '../types'

export interface ChatParams {
  apiKey: string
  systemPrompt: string
  context?: string
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
}

export interface ChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: number
  }
}

export const chatTool: ToolConfig<ChatParams, ChatResponse> = {
  id: 'anthropic_chat',
  name: 'Anthropic Chat',
  description:
    "Interact with Anthropic's Claude models for advanced language understanding, reasoning, and generation tasks. Supports system prompts, context management, and configurable parameters for response generation.",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'Anthropic API key',
    },
    systemPrompt: {
      type: 'string',
      required: true,
      description: 'System prompt to send to the model',
    },
    context: {
      type: 'string',
      description: 'User message/context to send to the model',
    },
    model: {
      type: 'string',
      default: 'claude-3-7-sonnet-20250219',
      description: 'Model to use',
    },
    temperature: {
      type: 'number',
      default: 0.7,
      description: 'Controls randomness in the response',
    },
    maxTokens: {
      type: 'number',
      default: 4096,
      description: 'Maximum number of tokens to generate',
    },
  },

  request: {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    }),
    body: (params) => {
      const messages = []

      // Add user message if context is provided
      if (params.context) {
        messages.push({
          role: 'user',
          content: params.context,
        })
      }

      return {
        model: params.model || 'claude-3-7-sonnet-20250219',
        messages,
        system: params.systemPrompt,
        temperature: params.temperature || 0.7,
        max_tokens: params.maxTokens || 4096,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.content) {
      throw new Error('Unable to extract content from Anthropic API response')
    }

    return {
      success: true,
      output: {
        content: data.content[0].text,
        model: data.model,
        tokens: data.usage?.input_tokens + data.usage?.output_tokens,
      },
    }
  },

  transformError: (error) => {
    const message = error.error?.message || error.message
    const code = error.error?.type || error.code
    return `${message} (${code})`
  },
}
