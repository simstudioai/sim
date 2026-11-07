import { FALAI_HOSTED_KEY_MARKUP_MULTIPLIER } from '@/lib/tools/falai-pricing'
import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'
import { parseBooleanParam } from '@/tools/video/utils'

export const falaiVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_falai',
  name: 'Fal.ai Video Generation',
  description:
    'Generate a video from a text prompt, and optionally a start frame image, with a model in the Fal.ai video catalog',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (falai)',
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
        'A Video Generator fal model ID, such as veo-3.1, kling/v4/text-to-video, or minimax/h3-max/text-to-video',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text prompt describing the video to generate',
    },
    duration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video duration in seconds (varies by model)',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio supported by the selected model',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video resolution supported by the selected model',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override prompt optimization when supported by the selected model',
    },
    generateAudio: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate native audio when supported by the selected Fal.ai model',
    },
    visualReference: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Start frame image (UserFile); sends the request to the model's image-to-video endpoint",
    },
  },

  hosting: {
    envKeyPrefix: 'FALAI_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'falai',
    exactCostSettlement: 'falai',
    requiresPaidPlan: true,
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const providerCostDollars = output.__falaiCostDollars
        if (typeof providerCostDollars !== 'number' || Number.isNaN(providerCostDollars)) {
          throw new Error('Fal.ai video response missing cost data')
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

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (
      params: VideoParams & {
        __usingHostedKey?: boolean
      }
    ) => ({
      provider: 'falai',
      apiKey: params.apiKey,
      model: params.model,
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      promptOptimizer: parseBooleanParam(params.promptOptimizer),
      generateAudio: parseBooleanParam(params.generateAudio),
      visualReference: params.visualReference,
      useHostedCostTracking: params.__usingHostedKey === true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Video generation failed',
        output: {
          videoUrl: '',
        },
      }
    }

    if (!data.videoUrl) {
      return {
        success: false,
        error: 'Missing videoUrl in response',
        output: {
          videoUrl: '',
        },
      }
    }

    return {
      success: true,
      output: {
        videoUrl: data.videoUrl,
        videoFile: data.videoFile,
        duration: data.duration,
        width: data.width,
        height: data.height,
        provider: 'falai',
        model: data.model,
        jobId: data.jobId,
        __falaiCostDollars: data.__falaiCostDollars,
        __falaiBilling: data.__falaiBilling,
      },
    }
  },

  outputs: {
    videoUrl: { type: 'string', description: 'Generated video URL' },
    videoFile: { type: 'file', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used (falai)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Job ID' },
  },
}
