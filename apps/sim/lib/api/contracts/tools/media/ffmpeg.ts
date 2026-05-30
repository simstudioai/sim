import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Supported FFmpeg operations. Each maps to a tool id of the form `ffmpeg_<operation>`.
 */
export const ffmpegOperations = [
  'convert',
  'extract_audio',
  'trim',
  'compress',
  'probe',
  'thumbnail',
  'concat',
  'volume',
  'speed',
] as const

export type FfmpegOperation = (typeof ffmpegOperations)[number]

const MISSING_FILE_ERROR = 'A media file is required'

export const ffmpegFileSchema = userFileSchema.extend({
  type: z.string().optional().default(''),
})

export const ffmpegToolBodySchema = z
  .object({
    operation: z.enum(ffmpegOperations, {
      error: `operation must be one of: ${ffmpegOperations.join(', ')}`,
    }),
    /** Single input file (all operations except `concat`). */
    file: ffmpegFileSchema.optional(),
    /** Multiple input files (`concat` operation). */
    files: z.array(ffmpegFileSchema).min(2, 'concat requires at least 2 files').optional(),
    /** Output container/format, e.g. `mp4`, `webm`, `mp3`, `wav`. */
    format: z.string().min(1).max(16).optional(),
    /** Explicit video codec override, e.g. `libx264`, `vp9`. */
    videoCodec: z.string().min(1).max(32).optional(),
    /** Explicit audio codec override, e.g. `aac`, `libmp3lame`. */
    audioCodec: z.string().min(1).max(32).optional(),
    /** Trim start offset in seconds or `HH:MM:SS(.ms)`. */
    startTime: z.string().min(1).max(32).optional(),
    /** Trim duration in seconds or `HH:MM:SS(.ms)`. */
    duration: z.string().min(1).max(32).optional(),
    /** Scale dimensions for compress, e.g. `1280:720`, `1280x720`, `1280:-2`, `50%`. */
    scale: z.string().min(1).max(32).optional(),
    /** Constant Rate Factor for compress (0 = lossless, 51 = worst). */
    crf: z.coerce.number().int().min(0).max(51).optional(),
    /** Target video bitrate for compress, e.g. `1M`, `800k`. */
    videoBitrate: z.string().min(1).max(16).optional(),
    /** Timestamp for thumbnail extraction in seconds or `HH:MM:SS(.ms)`. */
    time: z.string().min(1).max(32).optional(),
    /** Volume adjustment: a multiplier (`1.5`, `0.5`) or decibel value (`10dB`, `-6dB`). */
    volume: z.string().min(1).max(16).optional(),
    /** Playback speed multiplier for the `speed` operation (0.5 = half, 2 = double). */
    speed: z.coerce
      .number()
      .min(0.1, 'speed must be at least 0.1 (10x slower)')
      .max(100, 'speed must be at most 100 (100x faster)')
      .optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.operation === 'concat') {
      if (!data.files || data.files.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['files'],
          message: 'concat requires at least 2 input files',
        })
      }
    } else if (!data.file) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: MISSING_FILE_ERROR })
    }
  })

export type FfmpegToolBody = z.input<typeof ffmpegToolBodySchema>

export const ffmpegToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ffmpeg/process',
  body: ffmpegToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
