import type { InsForgeCompletionParams, InsForgeCompletionResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const completionTool: ToolConfig<InsForgeCompletionParams, InsForgeCompletionResponse> = {
  id: 'insforge_completion',
  name: 'InsForge AI Completion',
  description: 'Generate AI chat completions using InsForge',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The model to use (e.g., "gpt-4o", "gpt-4o-mini")',
    },
    messages: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of messages with role (system/user/assistant) and content',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sampling temperature (0-2, default: 1)',
    },
    maxTokens: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum tokens to generate',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/api/ai/chat/completion`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        messages: params.messages,
      }

      if (params.model) {
        body.model = params.model
      }

      if (params.temperature !== undefined) {
        body.temperature = params.temperature
      }

      if (params.maxTokens) {
        body.max_tokens = params.maxTokens
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge AI completion response: ${parseError}`)
    }

    const content = data?.choices?.[0]?.message?.content || ''
    const usage = data?.usage

    return {
      success: true,
      output: {
        message: 'Successfully generated completion',
        content,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    content: { type: 'string', description: 'Generated completion text' },
    usage: { type: 'json', description: 'Token usage statistics' },
  },
}
