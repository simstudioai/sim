import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  HuntApiDownloadAudioParams,
  HuntApiDownloadAudioResponse,
} from '@/tools/huntapi/types'
import type { ToolConfig } from '@/tools/types'

export const huntapiDownloadAudioTool: ToolConfig<
  HuntApiDownloadAudioParams,
  HuntApiDownloadAudioResponse
> = {
  id: 'huntapi_download_audio',
  name: 'HuntAPI Download Audio',
  description:
    'Start extracting the audio track of a public video as MP3 or another format. Returns a job ID; use Get Job to get the file link once the job completes.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the public video (e.g., "https://www.youtube.com/watch?v=jNQXAC9IVRw")',
    },
    audioQuality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quality: best, 320kbps, 256kbps or 128kbps (defaults to "best")',
    },
    audioFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred format: mp3, m4a or wav (defaults to "mp3")',
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
      const url = new URL(`https://api.huntapi.com/v1/audio/download`)
      url.searchParams.set('query', params.url.trim())
      if (params.audioQuality?.trim())
        url.searchParams.set('audio_quality', params.audioQuality.trim())
      if (params.audioFormat?.trim())
        url.searchParams.set('audio_format', params.audioFormat.trim())
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
