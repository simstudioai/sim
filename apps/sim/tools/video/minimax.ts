import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const minimaxVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_minimax',
  name: 'MiniMax Hailuo Video',
  description:
    'Generate videos using MiniMax Hailuo through MiniMax Platform API with advanced realism and prompt optimization',
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
      description: 'MiniMax model: hailuo-02 (default)',
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
      description: 'Video duration in seconds (6 or 10, default: 6)',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable prompt optimization for better results (default: true)',
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
      provider: 'minimax',
      apiKey: params.apiKey,
      model: params.model || 'hailuo-02',
      prompt: params.prompt,
      duration: params.duration || 6,
      promptOptimizer: params.promptOptimizer !== false, // Default true
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
        provider: 'minimax',
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
    provider: { type: 'string', description: 'Provider used (minimax)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'MiniMax job ID' },
  },
}
