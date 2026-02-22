import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export interface ModelsLabVideoParams {
  provider: string
  apiKey: string
  prompt: string
  model?: 'text2video' | 'img2video'
  imageUrl?: string
  width?: number
  height?: number
  num_frames?: number
}

export const modelsLabVideoTool: ToolConfig<ModelsLabVideoParams, VideoResponse> = {
  id: 'video_modelslab',
  name: 'ModelsLab Video',
  description: 'Generate videos using ModelsLab text-to-video or image-to-video API',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Video provider (modelslab)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ModelsLab API key',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text prompt describing the video to generate',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generation mode: text2video (default) or img2video',
    },
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image URL for img2video mode (required when model is img2video)',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video width in pixels (default: 512)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Video height in pixels (default: 512)',
    },
    num_frames: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of frames (default: 16)',
    },
  },

  request: {
    url: '/api/tools/video',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ModelsLabVideoParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'modelslab',
      apiKey: params.apiKey,
      prompt: params.prompt,
      model: params.model || 'text2video',
      imageUrl: params.imageUrl,
      width: params.width || 512,
      height: params.height || 512,
      num_frames: params.num_frames || 16,
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
        provider: 'modelslab',
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
    provider: { type: 'string', description: 'Provider used (modelslab)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'ModelsLab job ID' },
  },
}
