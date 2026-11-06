import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'
import { parseBooleanParamWithDefault } from '@/tools/video/utils'

export const minimaxVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_minimax',
  name: 'MiniMax Video',
  description: 'Generate videos using MiniMax H3 and Hailuo models',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (minimax)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MiniMax API key from platform.minimax.io',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'MiniMax model: MiniMax-H3, MiniMax-H3-Highspeed, MiniMax-H3-Lite, MiniMax-H3-Max, hailuo-2.3, hailuo-02, T2V-01, or T2V-01-Director',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text prompt describing the video to generate',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio for H3 models, such as 16:9 or 9:16',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Model-specific resolution, such as 768P, 2K, or 1080P',
    },
    duration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video duration in seconds within the selected model limits',
    },
    endpoint: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Legacy Hailuo/T2V quality preference: standard or pro (1080P for supported 6s videos). Omit for H3; use resolution instead.',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enable prompt optimization for legacy Hailuo/T2V models (default: true). Omit for H3 models.',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (params) => ({
      provider: 'minimax',
      apiKey: params.apiKey,
      model: params.model || 'hailuo-2.3',
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      endpoint: params.endpoint,
      promptOptimizer:
        params.promptOptimizer === undefined
          ? undefined
          : parseBooleanParamWithDefault(params.promptOptimizer, true),
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
        provider: 'minimax',
        model: data.model,
        jobId: data.jobId,
      },
    }
  },

  outputs: {
    videoUrl: { type: 'string', description: 'Generated video URL' },
    videoFile: { type: 'file', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used (minimax)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'MiniMax job ID' },
  },
}
