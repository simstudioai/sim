import type { QuiverImageToSvgParams, QuiverSvgResponse } from '@/tools/quiver/types'
import type { ToolConfig } from '@/tools/types'

export const quiverImageToSvgTool: ToolConfig<QuiverImageToSvgParams, QuiverSvgResponse> = {
  id: 'quiver_image_to_svg',
  name: 'Quiver Image to SVG',
  description: 'Convert raster images into vector SVG format using QuiverAI',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuiverAI API key',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The model to use for vectorization (e.g., "arrow-preview")',
    },
    image: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'The raster image to vectorize into SVG',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sampling temperature (0-2, default 1)',
    },
    top_p: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Nucleus sampling probability (0-1, default 1)',
    },
    max_output_tokens: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum output tokens (1-131072)',
    },
    presence_penalty: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token penalty for prior output (-2 to 2, default 0)',
    },
    auto_crop: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically crop the image before vectorizing',
    },
    target_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Square resize target in pixels (128-4096)',
    },
  },

  request: {
    url: '/api/tools/quiver/image-to-svg',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      model: params.model,
      image: params.image,
      temperature: params.temperature,
      top_p: params.top_p,
      max_output_tokens: params.max_output_tokens,
      presence_penalty: params.presence_penalty,
      auto_crop: params.auto_crop,
      target_size: params.target_size,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to vectorize image')
    }

    return data
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the vectorization succeeded' },
    output: {
      type: 'object',
      description: 'Vectorized SVG output',
      properties: {
        file: {
          type: 'file',
          description: 'Generated SVG file',
        },
        svgContent: {
          type: 'string',
          description: 'Raw SVG markup content',
        },
        id: {
          type: 'string',
          description: 'Vectorization request ID',
        },
        usage: {
          type: 'json',
          description: 'Token usage statistics',
          properties: {
            totalTokens: { type: 'number', description: 'Total tokens used' },
            inputTokens: { type: 'number', description: 'Input tokens used' },
            outputTokens: { type: 'number', description: 'Output tokens used' },
          },
        },
      },
    },
  },
}
