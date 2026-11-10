import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  HuntApiDownloadVideoParams,
  HuntApiDownloadVideoResponse,
} from '@/tools/huntapi/types'
import type { ToolConfig } from '@/tools/types'

export const huntapiDownloadVideoTool: ToolConfig<
  HuntApiDownloadVideoParams,
  HuntApiDownloadVideoResponse
> = {
  id: 'huntapi_download_video',
  name: 'HuntAPI Download Video',
  description:
    'Start downloading a public video in a chosen quality and format. Returns a job ID; use Get Job to get the file link once the job completes.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the public video (e.g., "https://www.youtube.com/watch?v=jNQXAC9IVRw")',
    },
    videoQuality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Quality: best, 1080p, 720p, 480p or 360p (defaults to "best"); videos over an hour are capped at 720p',
    },
    videoFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred format: mp4, webm or mkv (defaults to "mp4")',
    },
    downloadType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'audio_video for the video with sound, video for the picture only (defaults to "audio_video")',
    },
    maxDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum duration in seconds; longer content is cut at this length',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'HuntAPI API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.huntapi.com/v1/video/download`)
      url.searchParams.set('query', params.url.trim())
      if (params.videoQuality?.trim())
        url.searchParams.set('video_quality', params.videoQuality.trim())
      if (params.videoFormat?.trim())
        url.searchParams.set('video_format', params.videoFormat.trim())
      if (params.downloadType?.trim())
        url.searchParams.set('download_type', params.downloadType.trim())
      if (params.maxDuration != null)
        url.searchParams.set('max_duration', String(params.maxDuration))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        jobId: toStringOrNull(data.job_id),
      },
    }
  },

  outputs: {
    jobId: {
      type: 'string',
      description: 'ID of the download job, to pass to Get Job',
      optional: true,
    },
  },
}
