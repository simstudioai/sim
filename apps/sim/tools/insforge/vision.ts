import type { InsForgeVisionParams, InsForgeVisionResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const visionTool: ToolConfig<InsForgeVisionParams, InsForgeVisionResponse> = {
  id: 'insforge_vision',
  name: 'InsForge AI Vision',
  description: 'Analyze images using InsForge AI vision capabilities',
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
      description: 'The vision model to use (e.g., "gpt-4o")',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The prompt describing what to analyze in the image',
    },
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the image to analyze',
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
      return `${base}/ai/v1/chat/completions`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: params.prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: params.imageUrl,
                },
              },
            ],
          },
        ],
      }

      if (params.model) {
        body.model = params.model
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
      throw new Error(`Failed to parse InsForge AI vision response: ${parseError}`)
    }

    const content = data?.choices?.[0]?.message?.content || ''
    const usage = data?.usage

    return {
      success: true,
      output: {
        message: 'Successfully analyzed image',
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
    content: { type: 'string', description: 'Analysis result text' },
    usage: { type: 'json', description: 'Token usage statistics' },
  },
}
