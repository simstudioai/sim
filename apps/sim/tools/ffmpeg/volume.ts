import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegFileResponse, FfmpegVolumeParams } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegVolumeTool: ToolConfig<FfmpegVolumeParams, FfmpegFileResponse> = {
  id: 'ffmpeg_volume',
  name: 'FFmpeg Adjust Volume',
  description: 'Adjust the audio volume of a video or audio file',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The media file to adjust',
    },
    volume: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Volume as a multiplier (e.g. 1.5, 0.5) or decibels (e.g. 10dB, -6dB)',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'volume',
      file: params.file,
      volume: params.volume,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
