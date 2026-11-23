import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const veoVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_veo',
  name: 'Google Gemini Video',
  description: 'Generate videos using Google Gemini Omni with native audio generation',
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
      description: 'Google model: gemini-omni-1.1-flash; older Veo endpoints have retired',
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
      description:
        'Legacy duration setting; omit for Gemini Omni and describe timing in the prompt',
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
      description: 'Video resolution: 360p, 720p, 1080p, or 4k (default: 720p)',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (params) => ({
      provider: 'veo',
      apiKey: params.apiKey,
      model: params.model || 'gemini-omni-1.1-flash',
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
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
    jobId: { type: 'string', description: 'Google interaction ID' },
  },
}
