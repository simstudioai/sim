import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegConvertParams, FfmpegFileResponse } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegConvertTool: ToolConfig<FfmpegConvertParams, FfmpegFileResponse> = {
  id: 'ffmpeg_convert',
  name: 'FFmpeg Convert',
  description: 'Convert (transcode) a video or audio file to a different container/format',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The media file to convert',
    },
    format: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target output format/container (e.g. mp4, webm, mov, mkv, mp3, wav)',
    },
    videoCodec: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional video codec override (e.g. libx264, vp9)',
    },
    audioCodec: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional audio codec override (e.g. aac, libmp3lame)',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'convert',
      file: params.file,
      format: params.format,
      videoCodec: params.videoCodec,
      audioCodec: params.audioCodec,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
