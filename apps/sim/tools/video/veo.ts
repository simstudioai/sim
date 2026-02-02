import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const veoVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_veo',
  name: 'Google Veo 3 Video',
  description: 'Generate videos using Google Veo 3/3.1 with native audio generation',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (veo)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Gemini API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Veo model: veo-3 (default, highest quality), veo-3-fast (faster), or veo-3.1 (latest)',
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
      description: 'Video duration in seconds (4, 6, or 8, default: 8)',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio: 16:9 (landscape) or 9:16 (portrait)',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video resolution: 720p or 1080p (default: 1080p)',
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
      }
    ) => ({
      provider: 'veo',
      apiKey: params.apiKey,
      model: params.model || 'veo-3',
      prompt: params.prompt,
      duration: params.duration || 8, // Default 8 seconds (valid: 4, 6, or 8)
      aspectRatio: params.aspectRatio || '16:9',
      resolution: params.resolution || '1080p',
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
        provider: 'veo',
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
    provider: { type: 'string', description: 'Provider used (veo)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Veo job ID' },
  },
}
