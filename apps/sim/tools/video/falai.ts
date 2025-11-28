import type { ToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const falaiVideoTool: ToolConfig<VideoParams, VideoResponse> = {
  id: 'video_falai',
  name: 'Fal.ai Video Generation',
  description:
    'Generate videos using Fal.ai platform with access to multiple models including Veo 3.1, Sora 2, Kling 2.5, MiniMax Hailuo, and more',
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
        'Fal.ai model: veo-3.1 (Google Veo 3.1), sora-2 (OpenAI Sora 2), kling-2.5-turbo-pro (Kling 2.5 Turbo Pro), kling-2.1-pro (Kling 2.1 Master), minimax-hailuo-2.3-pro (MiniMax Hailuo Pro), minimax-hailuo-2.3-standard (MiniMax Hailuo Standard), wan-2.1 (WAN T2V), ltxv-0.9.8 (LTXV 13B)',
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
      description: 'Video resolution (varies by model): 540p, 720p, 1080p',
    },
    promptOptimizer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable prompt optimization for MiniMax models (default: true)',
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
      provider: 'falai',
      apiKey: params.apiKey,
      model: params.model,
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      promptOptimizer: params.promptOptimizer !== false, // Default true for MiniMax
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
        provider: 'falai',
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
    provider: { type: 'string', description: 'Provider used (falai)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Job ID' },
  },
}
