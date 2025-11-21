import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const runwayVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_runway',
  name: 'Runway Gen-4 Video',
  description: 'Generate videos using Runway Gen-4 with world consistency and visual references',
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
      description: 'Runway model: gen-4 (default, higher quality) or gen-4-turbo (faster)',
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
      description: 'Video duration in seconds (5 or 10, default: 5)',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio: 16:9 (landscape), 9:16 (portrait), or 1:1 (square)',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video resolution (720p output). Note: Gen-4 Turbo outputs at 720p natively',
    },
    visualReference: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reference image REQUIRED for Gen-4 (UserFile object). Gen-4 only supports image-to-video, not text-only generation',
    },
  },

  request: {
    url: '/api/proxy/video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: VideoParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'runway',
      apiKey: params.apiKey,
      model: 'gen-4-turbo', // Only gen4_turbo model is supported
      prompt: params.prompt,
      duration: params.duration || 5,
      aspectRatio: params.aspectRatio || '16:9',
      resolution: params.resolution || '720p',
      visualReference: params.visualReference,
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
    videoFile: { type: 'json', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used (runway)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Runway job ID' },
  },
}
