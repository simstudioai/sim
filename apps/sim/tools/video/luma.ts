import type { InternalToolConfig } from '@/tools/types'
import type { VideoParams, VideoResponse } from '@/tools/video/types'

export const lumaVideoTool: InternalToolConfig<VideoParams, VideoResponse> = {
  id: 'video_luma',
  name: 'Luma Dream Machine Video',
  description: 'Generate videos using Luma Ray models',
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
      description:
        'Luma model: ray-3.2, ray-2, or ray-flash-2 (legacy models depend on account availability)',
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
      description: 'Video duration in seconds: 5 or 10 for Ray 3.2; 5 or 9 for legacy models',
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
      description:
        'Video resolution: 360p, 540p, 720p, or 1080p for Ray 3.2; legacy models also support 4k',
    },
    cameraControl: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Legacy Ray camera controls as an array of concept objects; omit for Ray 3.2 and describe camera motion in the prompt. Format: [{ "key": "concept_name" }]. Valid keys: truck_left, truck_right, pan_left, pan_right, tilt_up, tilt_down, zoom_in, zoom_out, push_in, pull_out, orbit_left, orbit_right, crane_up, crane_down, static, handheld, and 20+ more predefined options',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ prompt: params.prompt }),
    },
    input: (params) => ({
      provider: 'luma',
      apiKey: params.apiKey,
      model: params.model || 'ray-2',
      prompt: params.prompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      cameraControl: params.cameraControl,
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
    videoFile: { type: 'file', description: 'Video file object with metadata' },
    duration: { type: 'number', description: 'Video duration in seconds' },
    width: { type: 'number', description: 'Video width in pixels' },
    height: { type: 'number', description: 'Video height in pixels' },
    provider: { type: 'string', description: 'Provider used (luma)' },
    model: { type: 'string', description: 'Model used' },
    jobId: { type: 'string', description: 'Luma job ID' },
  },
}
