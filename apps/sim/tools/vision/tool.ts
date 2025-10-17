import type { ToolConfig } from '@/tools/types'
import type { VisionParams, VisionResponse } from '@/tools/vision/types'

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
      required: false,
      visibility: 'user-only',
      description: 'Publicly accessible image URL',
    },
    imageFile: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Image file to analyze',
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
    url: '/api/tools/vision/analyze',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        apiKey: params.apiKey,
        imageUrl: params.imageUrl || null,
        imageFile: params.imageFile || null,
        model: params.model || 'gpt-4o',
        prompt: params.prompt || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to analyze image')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The analyzed content and description of the image',
    },
    model: {
      type: 'string',
      description: 'The vision model that was used for analysis',
      optional: true,
    },
    tokens: {
      type: 'number',
      description: 'Total tokens used for the analysis',
      optional: true,
    },
    usage: {
      type: 'object',
      description: 'Detailed token usage breakdown',
      optional: true,
      properties: {
        input_tokens: { type: 'number', description: 'Tokens used for input processing' },
        output_tokens: { type: 'number', description: 'Tokens used for response generation' },
        total_tokens: { type: 'number', description: 'Total tokens consumed' },
      },
    },
  },
}
