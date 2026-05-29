import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegCompressParams, FfmpegFileResponse } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegCompressTool: ToolConfig<FfmpegCompressParams, FfmpegFileResponse> = {
  id: 'ffmpeg_compress',
  name: 'FFmpeg Compress',
  description: 'Compress and/or rescale a video to reduce file size',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The video file to compress',
    },
    scale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional output dimensions, e.g. 1280x720, 1280:720, or 1280:-2 (keep aspect ratio)',
    },
    crf: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Constant Rate Factor (0 = lossless, 23 = default, 51 = worst quality)',
    },
    videoBitrate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional target video bitrate, e.g. 1M or 800k',
    },
    videoCodec: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional video codec override (defaults to libx264)',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'compress',
      file: params.file,
      scale: params.scale,
      crf: params.crf,
      videoBitrate: params.videoBitrate,
      videoCodec: params.videoCodec,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
