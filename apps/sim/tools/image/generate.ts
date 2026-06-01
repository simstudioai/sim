import { FALAI_HOSTED_KEY_MARKUP_MULTIPLIER } from '@/lib/tools/falai-pricing'
import type { ImageGenerationParams, ImageGenerationResponse } from '@/tools/image/types'
import type { ToolConfig } from '@/tools/types'

export const imageGenerateTool: ToolConfig<ImageGenerationParams, ImageGenerationResponse> = {
  id: 'image_generate',
  name: 'Image Generator',
  description: 'Generate images with OpenAI GPT Image, Google Nano Banana, or Fal.ai image models',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Image generation provider: openai, gemini, or falai',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Provider API key',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Provider model ID, such as gpt-image-1.5, gemini-3.1-flash-image-preview, or nano-banana-2',
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
      description: 'Provider-specific image size',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio, such as auto, 1:1, 16:9, or 9:16',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Provider-specific image resolution, such as 1K, 2K, 4K, 1k, or 2k',
    },
    quality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Provider-specific image quality',
    },
    background: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background setting when supported',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output image format: png, jpeg, or webp where supported',
    },
    moderation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OpenAI moderation level: auto or low',
    },
    safetyTolerance: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fal.ai safety tolerance when supported',
    },
    numImages: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of images to generate, subject to provider limits',
    },
    seed: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Random seed when supported',
    },
    enableSafetyChecker: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable the Fal.ai safety checker when supported',
    },
    enableWebSearch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable web search grounding when supported by the selected Fal.ai model',
    },
    thinkingLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fal.ai thinking level when supported: minimal or high',
    },
  },

  hosting: {
    enabled: (params) => params.provider === 'falai',
    envKeyPrefix: 'FALAI_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'falai',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const providerCostDollars = output.__falaiCostDollars
        if (typeof providerCostDollars !== 'number' || Number.isNaN(providerCostDollars)) {
          throw new Error('Fal.ai image response missing cost data')
        }

        return {
          cost: providerCostDollars * FALAI_HOSTED_KEY_MARKUP_MULTIPLIER,
          metadata: {
            ...(typeof output.__falaiBilling === 'object' && output.__falaiBilling !== null
              ? (output.__falaiBilling as Record<string, unknown>)
              : {}),
            providerCostDollars,
            markupMultiplier: FALAI_HOSTED_KEY_MARKUP_MULTIPLIER,
          },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 40,
      burstMultiplier: 1,
    },
  },

  request: {
    url: '/api/tools/image',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ImageGenerationParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
        __usingHostedKey?: boolean
      }
    ) => ({
      provider: params.provider,
      apiKey: params.apiKey,
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      quality: params.quality,
      background: params.background,
      outputFormat: params.outputFormat,
      moderation: params.moderation,
      safetyTolerance: params.safetyTolerance,
      numImages: params.numImages,
      seed: params.seed,
      enableSafetyChecker: params.enableSafetyChecker,
      enableWebSearch: params.enableWebSearch,
      thinkingLevel: params.thinkingLevel,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
      useHostedCostTracking: params.__usingHostedKey === true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as {
      error?: string
      content?: string
      image?: string
      imageUrl?: string
      imageFile?: unknown
      fileName?: string
      contentType?: string
      provider?: string
      model?: string
      metadata?: ImageGenerationResponse['output']['metadata']
      __falaiCostDollars?: number
      __falaiBilling?: ImageGenerationResponse['output']['__falaiBilling']
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Image generation failed',
        output: {
          content: '',
          image: '',
          imageUrl: '',
          provider: data.provider || '',
          model: data.model || '',
          metadata: {
            provider: data.provider || '',
            model: data.model || '',
          },
        },
      }
    }

    const image =
      data.imageFile ||
      data.image ||
      (data.imageUrl
        ? {
            name: data.fileName || 'generated-image.png',
            url: data.imageUrl,
            mimeType: data.contentType || 'image/png',
          }
        : '')

    return {
      success: true,
      output: {
        content: data.content || data.imageUrl || 'direct-image',
        image,
        imageUrl: data.imageUrl || '',
        provider: data.provider || data.metadata?.provider || '',
        model: data.model || data.metadata?.model || '',
        metadata: {
          provider: data.provider || data.metadata?.provider || '',
          model: data.model || data.metadata?.model || '',
          ...data.metadata,
        },
        __falaiCostDollars: data.__falaiCostDollars,
        __falaiBilling: data.__falaiBilling,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Generated image URL or identifier' },
    image: { type: 'file', description: 'Generated image file' },
    imageUrl: { type: 'string', description: 'Generated image URL' },
    provider: { type: 'string', description: 'Provider used' },
    model: { type: 'string', description: 'Model used' },
    metadata: {
      type: 'json',
      description: 'Generation metadata',
      properties: {
        provider: { type: 'string', description: 'Provider used' },
        model: { type: 'string', description: 'Model used' },
        description: { type: 'string', description: 'Provider description', optional: true },
        revisedPrompt: { type: 'string', description: 'Revised prompt', optional: true },
        seed: { type: 'number', description: 'Seed used for generation', optional: true },
        jobId: { type: 'string', description: 'Provider job ID', optional: true },
        contentType: { type: 'string', description: 'Image MIME type', optional: true },
      },
    },
  },
}
