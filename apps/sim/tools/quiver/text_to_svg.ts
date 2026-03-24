import type { QuiverSvgResponse, QuiverTextToSvgParams } from '@/tools/quiver/types'
import type { ToolConfig } from '@/tools/types'

export const quiverTextToSvgTool: ToolConfig<QuiverTextToSvgParams, QuiverSvgResponse> = {
  id: 'quiver_text_to_svg',
  name: 'Quiver Text to SVG',
  description: 'Generate SVG images from text prompts using QuiverAI',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuiverAI API key',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A text description of the desired SVG',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The model to use for SVG generation (e.g., "arrow-preview")',
    },
    instructions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Style or formatting guidance for the SVG output',
    },
    references: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference images to guide SVG generation (up to 4)',
    },
    n: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of SVGs to generate (1-16, default 1)',
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
  },

  request: {
    url: '/api/tools/quiver/text-to-svg',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      prompt: params.prompt,
      model: params.model,
      instructions: params.instructions,
      references: params.references,
      n: params.n,
      temperature: params.temperature,
      top_p: params.top_p,
      max_output_tokens: params.max_output_tokens,
      presence_penalty: params.presence_penalty,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate SVG')
    }

    return data
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the SVG generation succeeded' },
    output: {
      type: 'object',
      description: 'Generated SVG output',
      properties: {
        file: {
          type: 'file',
          description: 'First generated SVG file',
        },
        files: {
          type: 'json',
          description: 'All generated SVG files (when n > 1)',
        },
        svgContent: {
          type: 'string',
          description: 'Raw SVG markup content of the first result',
        },
        id: {
          type: 'string',
          description: 'Generation request ID',
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
