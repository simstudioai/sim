import type { ToolConfig } from '@/tools/types'
import type { ImageParams, ImageResponse } from '@/tools/image/types'

export const falaiImageTool: ToolConfig<ImageParams, ImageResponse> = {
  id: 'falai_image',
  name: 'Fal.ai Image Generation',
  description:
    'Generate images using Fal.ai platform with access to FLUX models including Schnell, Dev, Pro, and more',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Image provider (falai)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fal.ai API key',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Fal.ai model path (e.g., fal-ai/flux/schnell, fal-ai/flux/dev, fal-ai/flux-pro/v1.1)',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text prompt describing the image to generate',
    },
    size: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image size: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9',
    },
    numInferenceSteps: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of inference steps (1-50, default varies by model)',
    },
    enableSafetyChecker: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable safety checker (default: true)',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: png or jpeg (default: png)',
    },
  },

  request: {
    url: '/api/proxy/image/falai',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ImageParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'falai',
      apiKey: params.apiKey,
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      numInferenceSteps: params.numInferenceSteps,
      enableSafetyChecker: params.enableSafetyChecker,
      outputFormat: params.outputFormat,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Image generation failed',
        output: {
          content: '',
          image: '',
          metadata: {
            model: '',
          },
        },
      }
    }

    return {
      success: true,
      output: {
        content: data.imageUrl || '',
        image: data.image || '',
        metadata: {
          model: data.model || '',
          provider: 'falai',
          width: data.width,
          height: data.height,
          contentType: data.contentType,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Image URL' },
    image: { type: 'string', description: 'Base64 encoded image data' },
    metadata: {
      type: 'object',
      description: 'Image generation metadata',
      properties: {
        model: { type: 'string', description: 'Model used for image generation' },
        provider: { type: 'string', description: 'Provider used (falai)' },
        width: { type: 'number', description: 'Image width in pixels' },
        height: { type: 'number', description: 'Image height in pixels' },
        contentType: { type: 'string', description: 'Image content type' },
      },
    },
  },
}
