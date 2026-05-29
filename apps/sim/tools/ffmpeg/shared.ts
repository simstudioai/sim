import type { FfmpegContext, FfmpegFileResponse, FfmpegProbeResponse } from '@/tools/ffmpeg/types'
import type { OutputProperty } from '@/tools/types'

export const FFMPEG_PROCESS_URL = '/api/tools/ffmpeg/process'

/**
 * Extracts the execution context fields injected into tool params at runtime.
 */
export function ffmpegContextBody(params: FfmpegContext): {
  workspaceId?: string
  workflowId?: string
  executionId?: string
} {
  return {
    workspaceId: params._context?.workspaceId,
    workflowId: params._context?.workflowId,
    executionId: params._context?.executionId,
  }
}

/**
 * Shared transform for FFmpeg operations that produce a single output file.
 */
export async function transformFfmpegFileResponse(response: Response): Promise<FfmpegFileResponse> {
  const data = await response.json()

  if (!response.ok || data.error || data.success === false) {
    return {
      success: false,
      error: data.error || 'FFmpeg processing failed',
      output: { file: undefined as never, fileName: '', format: '', size: 0 },
    }
  }

  const output = data.output ?? {}
  return {
    success: true,
    output: {
      file: output.file,
      fileName: output.fileName ?? '',
      format: output.format ?? '',
      size: output.size ?? 0,
    },
  }
}

/**
 * Transform for the FFmpeg probe operation that returns media metadata.
 */
export async function transformFfmpegProbeResponse(
  response: Response
): Promise<FfmpegProbeResponse> {
  const data = await response.json()

  const emptyOutput = {
    durationSeconds: null,
    format: null,
    bitrate: null,
    width: null,
    height: null,
    hasVideo: false,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null,
    streams: [],
  }

  if (!response.ok || data.error || data.success === false) {
    return {
      success: false,
      error: data.error || 'FFmpeg probe failed',
      output: emptyOutput,
    }
  }

  const output = data.output ?? {}
  return {
    success: true,
    output: {
      durationSeconds: output.durationSeconds ?? null,
      format: output.format ?? null,
      bitrate: output.bitrate ?? null,
      width: output.width ?? null,
      height: output.height ?? null,
      hasVideo: Boolean(output.hasVideo),
      hasAudio: Boolean(output.hasAudio),
      videoCodec: output.videoCodec ?? null,
      audioCodec: output.audioCodec ?? null,
      streams: Array.isArray(output.streams) ? output.streams : [],
    },
  }
}

export const FFMPEG_FILE_OUTPUTS: Record<string, OutputProperty> = {
  file: { type: 'file', description: 'The processed media file for use in downstream blocks' },
  fileName: { type: 'string', description: 'Generated output file name' },
  format: { type: 'string', description: 'Output container/format' },
  size: { type: 'number', description: 'Output file size in bytes' },
}

export const FFMPEG_PROBE_OUTPUTS: Record<string, OutputProperty> = {
  durationSeconds: { type: 'number', description: 'Media duration in seconds', nullable: true },
  format: { type: 'string', description: 'Container format name', nullable: true },
  bitrate: { type: 'number', description: 'Overall bitrate in bits per second', nullable: true },
  width: { type: 'number', description: 'Video width in pixels', nullable: true },
  height: { type: 'number', description: 'Video height in pixels', nullable: true },
  hasVideo: { type: 'boolean', description: 'Whether the media contains a video stream' },
  hasAudio: { type: 'boolean', description: 'Whether the media contains an audio stream' },
  videoCodec: { type: 'string', description: 'Primary video codec', nullable: true },
  audioCodec: { type: 'string', description: 'Primary audio codec', nullable: true },
  streams: {
    type: 'array',
    description: 'All detected media streams',
    items: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Stream index' },
        type: { type: 'string', description: 'Stream type (video, audio, subtitle)' },
        codec: { type: 'string', description: 'Stream codec name' },
        width: { type: 'number', description: 'Stream width in pixels' },
        height: { type: 'number', description: 'Stream height in pixels' },
      },
    },
  },
}
