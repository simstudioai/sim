import type { ToolConfig } from '@/tools/types'
import type { ImageGenerationParams, ImageGenerationRequestBody } from '@/tools/image/types'

export interface ModelsLabImageResponse {
  imageUrl?: string
  imageFile?: string
  model?: string
  provider?: string
}

export const modelsLabImageTool: ToolConfig<ImageGenerationParams, ModelsLabImageResponse> = {
  id: 'image_modelslab',
  name: 'ModelsLab Image Generation',
  description:
    'Generate images using ModelsLab with access to Flux, Juggernaut XL, RealVisXL, DreamShaper, and hundreds of community models',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Image provider (modelslab)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ModelsLab API key',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Model ID: flux (Flux Schnell), juggernaut-xl-v10 (Juggernaut XL), realvisxlV50_v50Bakedvae (RealVisXL v5), dreamshaperXL10_alpha2Xl10 (DreamShaper XL)',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text description of the image to generate',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image width in pixels (default: 1024)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image height in pixels (default: 1024)',
    },
    negativePrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'What to exclude from the image',
    },
  },

  request: {
    url: '/api/tools/image/generate',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ImageGenerationParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ): ImageGenerationRequestBody => ({
      provider: 'modelslab',
      apiKey: params.apiKey,
      model: params.model,
      prompt: params.prompt,
      width: params.width,
      height: params.height,
      negativePrompt: params.negativePrompt,
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
        output: {},
      }
    }

    return {
      success: true,
      output: {
        imageUrl: data.imageUrl,
        imageFile: data.imageFile,
        model: data.model,
        provider: 'modelslab',
      },
    }
  },

  outputs: {
    imageUrl: { type: 'string', description: 'Generated image URL' },
    imageFile: { type: 'file', description: 'Base64-encoded image data' },
    model: { type: 'string', description: 'Model used for generation' },
    provider: { type: 'string', description: 'Provider used (modelslab)' },
  },
}
