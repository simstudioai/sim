import { FALAI_HOSTED_KEY_MARKUP_MULTIPLIER } from '@/lib/tools/falai-pricing'
import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'
import { parseBooleanParam, parseBooleanParamWithDefault } from '@/tools/video/utils'

export const falaiVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_falai',
  name: 'Fal.ai Video Generation',
  description:
    'Generate videos using Fal.ai with access to Veo 3.1, Sora 2, Seedance 2.0, Kling 3.0, MiniMax Hailuo 2.3, WAN 2.2, LTX 2.3, and previously supported models',
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
        'Fal.ai model: veo-3.1, veo-3.1-fast, sora-2, sora-2-pro, seedance-2.0, seedance-2.0-fast, kling-v3-pro, kling-v3-4k, kling-o3-pro, kling-o3-4k, minimax-hailuo-2.3-pro, minimax-hailuo-2.3-standard, wan-2.2-a14b-turbo, ltx-2.3, ltx-2.3-fast, plus previously supported model IDs',
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
      description: 'Aspect ratio (varies by model): 16:9, 9:16, 1:1',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Video resolution (varies by model): 480p, 580p, 720p, 1080p, true_1080p, 1440p, 2160p, 4k',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable prompt optimization for MiniMax models (default: true)',
    },
    generateAudio: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate native audio when supported by the selected Fal.ai model',
    },
  },

  hosting: {
    envKeyPrefix: 'FALAI_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'falai',
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

  request: {
    url: '/api/tools/video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: VideoParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
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
      promptOptimizer: parseBooleanParamWithDefault(params.promptOptimizer, true),
      generateAudio: parseBooleanParam(params.generateAudio),
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
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
