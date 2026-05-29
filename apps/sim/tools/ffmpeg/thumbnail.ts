import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegFileResponse, FfmpegThumbnailParams } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegThumbnailTool: ToolConfig<FfmpegThumbnailParams, FfmpegFileResponse> = {
  id: 'ffmpeg_thumbnail',
  name: 'FFmpeg Thumbnail',
  description: 'Extract a single frame from a video at a given timestamp as an image',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The video file to extract a frame from',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in seconds or HH:MM:SS(.ms), e.g. 5 or 00:00:05. Defaults to 1s',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output image format (jpg, png, webp). Defaults to jpg',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'thumbnail',
      file: params.file,
      time: params.time,
      format: params.format,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
