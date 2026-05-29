import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegFileResponse, FfmpegSpeedParams } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegSpeedTool: ToolConfig<FfmpegSpeedParams, FfmpegFileResponse> = {
  id: 'ffmpeg_speed',
  name: 'FFmpeg Change Speed',
  description: 'Speed up or slow down playback of a video or audio file',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The media file to retime',
    },
    speed: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Playback speed multiplier (0.5 = half speed, 2 = double speed)',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'speed',
      file: params.file,
      speed: params.speed,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
