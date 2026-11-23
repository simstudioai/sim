import { directVideoDefaults } from '@/lib/media/direct-video-catalog'
import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const runwayVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_runway',
  name: 'Runway Video',
  description: 'Generate videos using Runway models with optional visual references',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (runway)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Runway API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Runway model ID, such as gen4.5, gen4_turbo, kling3.0_pro, or seedance2_5',
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
      description: 'Video duration in seconds, within the selected model limits',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Native frame size or aspect ratio supported by the selected model, such as 1280:720',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Separate resolution setting when supported; most Runway models encode resolution in aspectRatio',
    },
    generateAudio: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate audio when supported by the selected model',
    },
    visualReference: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference image (UserFile); required for gen4_turbo, optional for other models',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (params) => ({
      provider: 'runway',
      apiKey: params.apiKey,
      model: params.model || directVideoDefaults.runway,
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      visualReference: params.visualReference,
      generateAudio: params.generateAudio,
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
        provider: 'runway',
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
    provider: { type: 'string', description: 'Provider used (runway)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Runway job ID' },
  },
}
