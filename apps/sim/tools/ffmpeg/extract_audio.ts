import {
  FFMPEG_FILE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegFileResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegExtractAudioParams, FfmpegFileResponse } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegExtractAudioTool: ToolConfig<FfmpegExtractAudioParams, FfmpegFileResponse> = {
  id: 'ffmpeg_extract_audio',
  name: 'FFmpeg Extract Audio',
  description: 'Extract the audio track from a video file into an audio file',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The video file to extract audio from',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output audio format (mp3, wav, aac, flac, ogg, m4a, opus). Defaults to mp3',
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
      operation: 'extract_audio',
      file: params.file,
      format: params.format,
      audioCodec: params.audioCodec,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegFileResponse,

  outputs: FFMPEG_FILE_OUTPUTS,
}
