import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const lumaVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_luma',
  name: 'Luma Dream Machine Video',
  description: 'Generate videos using Luma Dream Machine with advanced camera controls',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (luma)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma AI API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Luma model: ray-2 (default)',
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
      description: 'Video resolution: 540p, 720p, or 1080p (default: 1080p)',
    },
    cameraControl: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Camera controls: { pan: number, zoom: number, tilt: number, truck: number, tracking: boolean }',
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
      provider: 'luma',
      apiKey: params.apiKey,
      model: params.model || 'ray-2',
      prompt: params.prompt,
      duration: params.duration || 5,
      aspectRatio: params.aspectRatio || '16:9',
      resolution: params.resolution || '1080p',
      cameraControl: params.cameraControl,
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
        provider: 'luma',
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
    provider: { type: 'string', description: 'Provider used (luma)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Luma job ID' },
  },
}
