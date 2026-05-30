import { execSync } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ffmpegToolContract } from '@/lib/api/contracts/tools/media/ffmpeg'
import { getValidationErrorMessage, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { StorageService } from '@/lib/uploads'
import type { ExecutionContext } from '@/lib/uploads/contexts/execution'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('FfmpegProcessAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FFMPEG_INPUT_BYTES = 200 * 1024 * 1024
const MAX_FFMPEG_OUTPUT_BYTES = 200 * 1024 * 1024

let ffmpegInitialized = false
let ffmpegAvailable = false

const FFMPEG_NOT_FOUND_ERROR =
  'FFmpeg not found. Install it on the server: apk add ffmpeg (Alpine) / apt-get install ffmpeg (Ubuntu) / brew install ffmpeg (macOS)'

/**
 * Lazily resolves the ffmpeg and ffprobe binaries. ffmpeg-static bundles ffmpeg
 * but not ffprobe, so ffprobe is resolved from the system PATH when present.
 */
function ensureFfmpeg(): void {
  if (ffmpegInitialized) {
    if (!ffmpegAvailable) throw new Error(FFMPEG_NOT_FOUND_ERROR)
    return
  }
  ffmpegInitialized = true

  if (ffmpegStatic && typeof ffmpegStatic === 'string') {
    try {
      fsSync.accessSync(ffmpegStatic, fsSync.constants.X_OK)
      ffmpeg.setFfmpegPath(ffmpegStatic)
      ffmpegAvailable = true
      logger.info('Using ffmpeg-static binary', { path: ffmpegStatic })
    } catch {
      // Fall through to system ffmpeg
    }
  }

  if (!ffmpegAvailable) {
    try {
      const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
      const resolved = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]
      if (resolved) {
        ffmpeg.setFfmpegPath(resolved)
        ffmpegAvailable = true
        logger.info('Using system ffmpeg binary', { path: resolved })
      }
    } catch {
      // ffmpeg not on PATH
    }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe'
    const resolvedProbe = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]
    if (resolvedProbe) {
      ffmpeg.setFfprobePath(resolvedProbe)
      logger.info('Using system ffprobe binary', { path: resolvedProbe })
    }
  } catch {
    // ffprobe not on PATH — only the `probe` operation strictly requires it
  }

  if (!ffmpegAvailable) {
    logger.warn('No ffmpeg binary found at initialization time')
    throw new Error(FFMPEG_NOT_FOUND_ERROR)
  }
}

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

function getMimeForFormat(format: string): string {
  const normalized = format.toLowerCase()
  return (
    VIDEO_MIME[normalized] ||
    AUDIO_MIME[normalized] ||
    IMAGE_MIME[normalized] ||
    'application/octet-stream'
  )
}

const AUDIO_CODEC: Record<string, string> = {
  mp3: 'libmp3lame',
  wav: 'pcm_s16le',
  flac: 'flac',
  m4a: 'aac',
  aac: 'aac',
  ogg: 'libvorbis',
  opus: 'libopus',
}

function getAudioCodec(format: string): string {
  return AUDIO_CODEC[format.toLowerCase()] || 'libmp3lame'
}

/**
 * Reduces a user- or filename-derived extension to a safe `[a-z0-9]` token.
 * Strips path separators, dots, and other metacharacters so the value can be
 * interpolated into a temp file name without enabling path traversal.
 */
function safeExtension(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
}

/**
 * Derives a safe file extension for an input temp file from its name or MIME type.
 */
function getInputExtension(file: UserFile): string {
  const fromName = safeExtension(path.extname(file.name || ''))
  if (fromName) return fromName
  const subtype = safeExtension((file.type || '').split('/')[1])
  return subtype || 'dat'
}

function isVideoExtension(ext: string): boolean {
  return ext.toLowerCase() in VIDEO_MIME
}

/**
 * Runs a configured fluent-ffmpeg command, resolving once the output file is written.
 */
function runFfmpeg(
  configure: (command: ffmpeg.FfmpegCommand) => ffmpeg.FfmpegCommand
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    configure(ffmpeg())
      .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .on('end', () => resolve())
      .run()
  })
}

interface ProbeResult {
  durationSeconds: number | null
  format: string | null
  bitrate: number | null
  width: number | null
  height: number | null
  hasVideo: boolean
  hasAudio: boolean
  videoCodec: string | null
  audioCodec: string | null
  streams: Array<{
    index: number
    type: string | null
    codec: string | null
    width: number | null
    height: number | null
  }>
}

function probeMedia(inputPath: string): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        const message = /cannot find ffprobe|ENOENT|not found/i.test(err.message)
          ? 'ffprobe binary not found. Install it on the server (it ships with a full ffmpeg install: apk add ffmpeg / apt-get install ffmpeg / brew install ffmpeg).'
          : `FFprobe error: ${err.message}`
        reject(new Error(message))
        return
      }
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')
      resolve({
        durationSeconds: metadata.format.duration ?? null,
        format: metadata.format.format_name ?? null,
        bitrate: metadata.format.bit_rate ? Number(metadata.format.bit_rate) : null,
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        hasVideo: Boolean(videoStream),
        hasAudio: Boolean(audioStream),
        videoCodec: videoStream?.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        streams: metadata.streams.map((s) => ({
          index: s.index,
          type: s.codec_type ?? null,
          codec: s.codec_name ?? null,
          width: s.width ?? null,
          height: s.height ?? null,
        })),
      })
    })
  })
}

/**
 * atempo only supports factors between 0.5 and 2.0; chain filters to reach
 * arbitrary speeds (e.g. 4x -> "atempo=2.0,atempo=2.0").
 */
function buildAtempoChain(speed: number): string {
  const factors: number[] = []
  let remaining = speed
  while (remaining > 2.0) {
    factors.push(2.0)
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  factors.push(remaining)
  return factors.map((f) => `atempo=${f.toFixed(6)}`).join(',')
}

/**
 * Normalizes a user-supplied scale value (`1280x720`, `1280:-2`, `1280:720`)
 * into an ffmpeg scale filter expression (`width:height`).
 */
function normalizeScale(scale: string): string {
  return scale.trim().replace(/x/gi, ':')
}

/**
 * Strict `width:height` form (each a positive integer or a negative auto value
 * like -1/-2). Rejects anything that could append extra filter stages.
 */
const SCALE_FILTER_PATTERN = /^-?\d{1,5}:-?\d{1,5}$/

/**
 * A linear multiplier (`1.5`, `0.5`) or a decibel value (`10dB`, `-6dB`).
 * Rejects commas, brackets, and any other filter-graph metacharacters.
 */
const VOLUME_FILTER_PATTERN = /^-?\d+(\.\d+)?(dB)?$/i

async function storeOutputFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  executionContext: ExecutionContext | null,
  userId?: string
): Promise<UserFile> {
  if (executionContext) {
    const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
    return uploadExecutionFile(executionContext, buffer, fileName, mimeType, userId)
  }

  const fileInfo = await StorageService.uploadFile({
    file: buffer,
    fileName,
    contentType: mimeType,
    context: 'copilot',
  })

  return {
    id: generateId(),
    name: fileInfo.name,
    url: `${getBaseUrl()}${fileInfo.path}`,
    size: fileInfo.size,
    type: mimeType,
    key: fileInfo.key,
    context: 'copilot',
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId()
  logger.info(`[${requestId}] FFmpeg process request started`)

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    logger.error(`[${requestId}] Authentication failed`, { error: authResult.error })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    ffmpegToolContract,
    request,
    {},
    {
      validationErrorResponse: (error) => {
        logger.warn(`[${requestId}] Invalid FFmpeg request`, { issues: error.issues })
        return validationErrorResponse(
          error,
          getValidationErrorMessage(error, 'Invalid request data')
        )
      },
    }
  )
  if (!parsed.success) return parsed.response

  const body = parsed.data.body
  const { operation, workspaceId, workflowId, executionId } = body
  const executionContext: ExecutionContext | null =
    workspaceId && workflowId && executionId ? { workspaceId, workflowId, executionId } : null

  let tempDir: string | null = null

  try {
    ensureFfmpeg()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-'))

    if (operation === 'probe') {
      const userFile = processFilesToUserFiles([body.file as RawFileInput], requestId, logger)[0]
      if (!userFile) {
        return NextResponse.json({ error: 'A valid media file is required' }, { status: 400 })
      }
      const inputBuffer = await downloadFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_FFMPEG_INPUT_BYTES,
      })
      const inputPath = path.join(tempDir, `input.${getInputExtension(userFile)}`)
      await fs.writeFile(inputPath, inputBuffer)

      const probe = await probeMedia(inputPath)
      logger.info(`[${requestId}] Probe completed`, { format: probe.format })
      return NextResponse.json({ success: true, output: probe })
    }

    if (operation === 'concat') {
      const userFiles = processFilesToUserFiles(
        (body.files ?? []) as RawFileInput[],
        requestId,
        logger
      )
      if (userFiles.length < 2) {
        return NextResponse.json(
          { error: 'concat requires at least 2 valid media files' },
          { status: 400 }
        )
      }

      const inputPaths: string[] = []
      for (let i = 0; i < userFiles.length; i++) {
        const file = userFiles[i]
        const buffer = await downloadFileFromStorage(file, requestId, logger, {
          maxBytes: MAX_FFMPEG_INPUT_BYTES,
        })
        const inputPath = path.join(tempDir, `concat-${i}.${getInputExtension(file)}`)
        await fs.writeFile(inputPath, buffer)
        inputPaths.push(inputPath)
      }

      const outExt = getInputExtension(userFiles[0])
      const outputPath = path.join(tempDir, `output.${outExt}`)
      const listPath = path.join(tempDir, 'concat-list.txt')
      const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
      await fs.writeFile(listPath, listContent)

      await runFfmpeg((cmd) =>
        cmd
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath)
      )

      const mimeType = getMimeForFormat(outExt)
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    // Single-input operations
    const userFile = processFilesToUserFiles([body.file as RawFileInput], requestId, logger)[0]
    if (!userFile) {
      return NextResponse.json({ error: 'A valid media file is required' }, { status: 400 })
    }
    const inputExt = getInputExtension(userFile)
    const inputBuffer = await downloadFileFromStorage(userFile, requestId, logger, {
      maxBytes: MAX_FFMPEG_INPUT_BYTES,
    })
    const inputPath = path.join(tempDir, `input.${inputExt}`)
    await fs.writeFile(inputPath, inputBuffer)

    let outExt = inputExt
    let mimeType = getMimeForFormat(inputExt)

    if (operation === 'convert') {
      outExt = safeExtension(body.format)
      if (!outExt) {
        return NextResponse.json(
          { error: 'A valid output format is required for the convert operation (e.g. mp4, mp3)' },
          { status: 400 }
        )
      }
      mimeType = getMimeForFormat(outExt)
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) => {
        let c = cmd.input(inputPath).toFormat(outExt)
        if (body.videoCodec) c = c.videoCodec(body.videoCodec)
        if (body.audioCodec) c = c.audioCodec(body.audioCodec)
        return c.output(outputPath)
      })
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'extract_audio') {
      outExt = safeExtension(body.format) || 'mp3'
      mimeType = getMimeForFormat(outExt)
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) =>
        cmd
          .input(inputPath)
          .noVideo()
          .audioCodec(body.audioCodec || getAudioCodec(outExt))
          .toFormat(outExt)
          .output(outputPath)
      )
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'trim') {
      if (!body.startTime && !body.duration) {
        return NextResponse.json(
          { error: 'trim requires startTime and/or duration' },
          { status: 400 }
        )
      }
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) => {
        let c = cmd.input(inputPath)
        if (body.startTime) c = c.setStartTime(body.startTime)
        if (body.duration) c = c.setDuration(body.duration)
        return c.toFormat(outExt).output(outputPath)
      })
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'compress') {
      let scaleFilter: string | undefined
      if (body.scale) {
        scaleFilter = normalizeScale(body.scale)
        if (!SCALE_FILTER_PATTERN.test(scaleFilter)) {
          return NextResponse.json(
            { error: 'Invalid scale. Use width:height with integers, e.g. 1280:720 or 1280:-2' },
            { status: 400 }
          )
        }
      }
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) => {
        let c = cmd
          .input(inputPath)
          .videoCodec(body.videoCodec || 'libx264')
          .audioCodec(body.audioCodec || 'copy')
        if (body.crf !== undefined) c = c.outputOptions(['-crf', String(body.crf)])
        if (body.videoBitrate) c = c.videoBitrate(body.videoBitrate)
        if (scaleFilter) c = c.videoFilters(`scale=${scaleFilter}`)
        return c.toFormat(outExt).output(outputPath)
      })
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'thumbnail') {
      outExt = safeExtension(body.format) || 'jpg'
      mimeType = getMimeForFormat(outExt)
      const time = body.time || '00:00:01'
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) =>
        cmd.input(inputPath).seekInput(time).outputOptions(['-frames:v', '1']).output(outputPath)
      )
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'volume') {
      if (!body.volume) {
        return NextResponse.json(
          { error: 'volume is required for the volume operation' },
          { status: 400 }
        )
      }
      const volume = body.volume.trim()
      if (!VOLUME_FILTER_PATTERN.test(volume)) {
        return NextResponse.json(
          { error: 'Invalid volume. Use a multiplier (e.g. 1.5) or decibels (e.g. 10dB, -6dB)' },
          { status: 400 }
        )
      }
      const outputPath = path.join(tempDir, `output.${outExt}`)
      const isVideo = isVideoExtension(inputExt)
      await runFfmpeg((cmd) => {
        let c = cmd.input(inputPath).audioFilters(`volume=${volume}`)
        if (isVideo) c = c.outputOptions(['-c:v', 'copy'])
        return c.toFormat(outExt).output(outputPath)
      })
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    if (operation === 'speed') {
      if (body.speed === undefined) {
        return NextResponse.json(
          { error: 'speed is required for the speed operation' },
          { status: 400 }
        )
      }
      const speed = body.speed
      const probe = await probeMedia(inputPath)
      const outputPath = path.join(tempDir, `output.${outExt}`)
      await runFfmpeg((cmd) => {
        let c = cmd.input(inputPath)
        if (probe.hasVideo) {
          c = c.outputOptions(['-filter:v', `setpts=${(1 / speed).toFixed(6)}*PTS`])
        }
        if (probe.hasAudio) {
          c = c.outputOptions(['-filter:a', buildAtempoChain(speed)])
        }
        return c.toFormat(outExt).output(outputPath)
      })
      return await finalize(outputPath, outExt, mimeType, executionContext, authResult.userId)
    }

    return NextResponse.json({ error: `Unsupported operation: ${operation}` }, { status: 400 })
  } catch (error) {
    const message = getErrorMessage(error, 'FFmpeg processing failed')
    logger.error(`[${requestId}] FFmpeg processing failed`, { operation, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function finalize(
    outputPath: string,
    format: string,
    mimeType: string,
    context: ExecutionContext | null,
    userId?: string
  ): Promise<NextResponse> {
    // Check size via stat before reading so an oversized output is rejected
    // without first pulling the entire file into memory.
    const { size: outputSize } = await fs.stat(outputPath)
    if (outputSize === 0) {
      throw new Error('FFmpeg produced an empty output file')
    }
    if (outputSize > MAX_FFMPEG_OUTPUT_BYTES) {
      throw new Error('Output file exceeds the maximum allowed size')
    }
    const outputBuffer = await fs.readFile(outputPath)
    const fileName = `ffmpeg-${operation}-${Date.now()}.${format}`
    const file = await storeOutputFile(outputBuffer, fileName, mimeType, context, userId)
    logger.info(`[${requestId}] FFmpeg ${operation} completed`, {
      fileName,
      size: outputBuffer.length,
    })
    return NextResponse.json({
      success: true,
      output: { file, fileName, format, size: outputBuffer.length },
    })
  }
})
