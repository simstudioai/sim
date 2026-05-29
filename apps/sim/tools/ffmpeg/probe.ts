import {
  FFMPEG_PROBE_OUTPUTS,
  FFMPEG_PROCESS_URL,
  ffmpegContextBody,
  transformFfmpegProbeResponse,
} from '@/tools/ffmpeg/shared'
import type { FfmpegProbeParams, FfmpegProbeResponse } from '@/tools/ffmpeg/types'
import type { ToolConfig } from '@/tools/types'

export const ffmpegProbeTool: ToolConfig<FfmpegProbeParams, FfmpegProbeResponse> = {
  id: 'ffmpeg_probe',
  name: 'FFmpeg Probe',
  description: 'Inspect a media file and return metadata (duration, format, codecs, resolution)',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The media file to inspect',
    },
  },

  request: {
    url: FFMPEG_PROCESS_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'probe',
      file: params.file,
      ...ffmpegContextBody(params),
    }),
  },

  transformResponse: transformFfmpegProbeResponse,

  outputs: FFMPEG_PROBE_OUTPUTS,
}
