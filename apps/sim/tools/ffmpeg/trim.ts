import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegFileResponse, FfmpegTrimParams } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegTrimTool: ToolConfig<FfmpegTrimParams, FfmpegFileResponse> = {
  id: 'ffmpeg_trim',
  name: 'FFmpeg Trim',
  description: 'Cut a segment from a video or audio file using a start time and/or duration',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The media file to trim',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start offset in seconds or HH:MM:SS(.ms), e.g. 5 or 00:00:05',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration to keep in seconds or HH:MM:SS(.ms), e.g. 30 or 00:00:30',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'trim',
      file: params.file,
      startTime: params.startTime,
      duration: params.duration,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
