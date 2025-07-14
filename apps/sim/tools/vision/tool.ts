import type { ToolConfig } from '../types'
import type { VisionParams, VisionResponse } from './types'

export const visionTool: ToolConfig<VisionParams, VisionResponse> = {
  id: 'vision_tool',
  name: 'Vision Tool',
  description:
    'Process and analyze images using advanced vision models. Capable of understanding image content, extracting text, identifying objects, and providing detailed visual descriptions.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key for the selected model provider',
    },
    imageUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Publicly accessible image URL',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vision model to use (gpt-4o, claude-3-opus-20240229, etc)',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom prompt for image analysis',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      if (params.model?.startsWith('claude-3')) {
        return 'https://api.anthropic.com/v1/messages'
      }
      return 'https://api.openai.com/v1/chat/completions'
    },
    headers: (params) => {
      const headers = {
        'Content-Type': 'application/json',
      }

      return params.model?.startsWith('claude-3')
        ? {
            ...headers,
            'x-api-key': params.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : {
            ...headers,
            Authorization: `Bearer ${params.apiKey}`,
          }
    },
    body: (params) => {
      const defaultPrompt = 'Please analyze this image and describe what you see in detail.'
      const prompt = params.prompt || defaultPrompt

      if (params.model?.startsWith('claude-3')) {
        return {
          model: params.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image',
                  source: { type: 'url', url: params.imageUrl },
                },
              ],
            },
          ],
        }
      }

      return {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: params.imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      throw new Error(data.error.message || 'Unknown error occurred')
    }

    const result = data.content?.[0]?.text || data.choices?.[0]?.message?.content
    if (!result) {
      throw new Error('No output content in response')
    }

    return {
      success: true,
      output: {
        content: result,
        model: data.model,
        tokens: data.content
          ? data.usage?.input_tokens + data.usage?.output_tokens
          : data.usage?.total_tokens,
      },
    }
  },

  transformError: (error) => {
    const message = error.error?.message || error.message
    const code = error.error?.type || error.code
    return `${message} (${code})`
  },
}
