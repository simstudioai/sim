import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Execution context injected into tool params at runtime.
 */
export interface FfmpegContext {
  _context?: {
    workspaceId?: string
    workflowId?: string
    executionId?: string
  }
}

export interface FfmpegFileOutput {
  /** The processed media file, stored and available to downstream blocks. */
  file: UserFile
  /** Generated output file name. */
  fileName: string
  /** Output container/format (e.g. `mp4`, `mp3`). */
  format: string
  /** Output file size in bytes. */
  size: number
}

export interface FfmpegFileResponse extends ToolResponse {
  output: FfmpegFileOutput
}

export interface FfmpegProbeStream {
  index: number
  type: string | null
  codec: string | null
  width: number | null
  height: number | null
}

export interface FfmpegProbeOutput {
  durationSeconds: number | null
  format: string | null
  bitrate: number | null
  width: number | null
  height: number | null
  hasVideo: boolean
  hasAudio: boolean
  videoCodec: string | null
  audioCodec: string | null
  streams: FfmpegProbeStream[]
}

export interface FfmpegProbeResponse extends ToolResponse {
  output: FfmpegProbeOutput
}

export interface FfmpegConvertParams extends FfmpegContext {
  file?: UserFile
  format: string
  videoCodec?: string
  audioCodec?: string
}

export interface FfmpegExtractAudioParams extends FfmpegContext {
  file?: UserFile
  format?: string
  audioCodec?: string
}

export interface FfmpegTrimParams extends FfmpegContext {
  file?: UserFile
  startTime?: string
  duration?: string
}

export interface FfmpegCompressParams extends FfmpegContext {
  file?: UserFile
  scale?: string
  crf?: number
  videoBitrate?: string
  videoCodec?: string
}

export interface FfmpegProbeParams extends FfmpegContext {
  file?: UserFile
}

export interface FfmpegThumbnailParams extends FfmpegContext {
  file?: UserFile
  time?: string
  format?: string
}

export interface FfmpegConcatParams extends FfmpegContext {
  files?: UserFile[]
}

export interface FfmpegVolumeParams extends FfmpegContext {
  file?: UserFile
  volume: string
}

export interface FfmpegSpeedParams extends FfmpegContext {
  file?: UserFile
  speed: number
}
