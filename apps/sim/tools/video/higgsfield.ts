import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'
import { parseBooleanParam } from '@/tools/video/utils'

export const higgsfieldVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_higgsfield',
  name: 'Higgsfield Video',
  description: 'Generate videos with Kling, Seedance, MiniMax, and Hailuo models on Higgsfield',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (higgsfield)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Higgsfield API key as KEY_ID:KEY_SECRET',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Higgsfield model endpoint: kling-video/v3.0-turbo/text-to-video, kling-video/v3.0/pro/text-to-video, kling-video/v3.0/std/text-to-video, kling-video/v2.5-turbo/pro/text-to-video, bytedance/seedance-2.0/text-to-video, minimax/h3/text-to-video, or minimax/hailuo-2.3/standard/text-to-video',
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
      description: 'Video duration in seconds within the selected model limits',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio supported by the selected model, such as 16:9, 9:16, or 1:1',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution for Kling 3.0 Turbo (720p, 1080p) or Seedance 2.0 (480p to 4k)',
    },
    generateAudio: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate native audio with Kling 3.0 Pro, Kling 3.0 Standard, or Seedance 2.0',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable prompt optimization for Hailuo 2.3 Standard',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (params) => ({
      provider: 'higgsfield',
      apiKey: params.apiKey,
      model: params.model || 'kling-video/v3.0-turbo/text-to-video',
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      generateAudio: parseBooleanParam(params.generateAudio),
      promptOptimizer: parseBooleanParam(params.promptOptimizer),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Video generation failed',
        output: { videoUrl: '' },
      }
    }

    if (!data.videoUrl) {
      return {
        success: false,
        error: 'Missing videoUrl in response',
        output: { videoUrl: '' },
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
        provider: 'higgsfield',
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
    provider: { type: 'string', description: 'Provider used (higgsfield)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Higgsfield request ID' },
  },
}
