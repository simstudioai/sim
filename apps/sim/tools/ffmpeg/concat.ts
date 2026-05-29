import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegConcatParams, FfmpegFileResponse } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegConcatTool: ToolConfig<FfmpegConcatParams, FfmpegFileResponse> = {
  id: 'ffmpeg_concat',
  name: 'FFmpeg Concatenate',
  description: 'Join multiple media files of the same format and codec into a single output file',
  version: '1.0.0',

  params: {
    files: {
      type: 'file[]',
      required: true,
      visibility: 'user-only',
      description: 'Two or more media files to join, in order. Files must share the same codec',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'concat',
      files: params.files,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
