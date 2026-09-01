import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type {
  AudioExtractionOptions,
  AudioExtractionResult,
  AudioMetadata,
} from '@/lib/audio/types'
import { resolveExecutable, runExecutable } from '@/lib/media/ffmpeg-process'

const logger = createLogger('AudioExtractor')

const INSTALL_HINT =
  'Install: brew install ffmpeg (macOS) / apk add ffmpeg (Alpine) / apt-get install ffmpeg (Ubuntu)'
const CONVERSION_TIMEOUT_MS = 10 * 60 * 1000
const PROBE_TIMEOUT_MS = 30 * 1000
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024

let binariesInitialized = false
let ffmpegPath: string | null = null
let ffprobePath: string | null = null

function initializeBinaries(): void {
  if (binariesInitialized) return
  binariesInitialized = true
  ffmpegPath = resolveExecutable('ffmpeg')
  ffprobePath = resolveExecutable('ffprobe')
  if (ffmpegPath) {
    logger.info('[FFmpeg] Using system ffmpeg:', ffmpegPath)
  } else {
    logger.warn('[FFmpeg] No FFmpeg binary found at init time')
  }
}

function requireFfmpeg(): string {
  initializeBinaries()
  if (!ffmpegPath) throw new Error(`FFmpeg not found. ${INSTALL_HINT}`)
  return ffmpegPath
}

function requireFfprobe(): string {
  initializeBinaries()
  if (!ffprobePath) throw new Error(`FFprobe not found. ${INSTALL_HINT}`)
  return ffprobePath
}

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await runExecutable(requireFfmpeg(), args, {
      maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
      timeoutMs: CONVERSION_TIMEOUT_MS,
    })
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('FFmpeg error: process output was too large to read')
    }
    if (failure.killed) {
      throw new Error('FFmpeg error: conversion exceeded the 600s limit')
    }
    throw new Error(`FFmpeg error: ${failure.stderr?.trim() || toError(error).message}`)
  }
}

/** Extract audio from video or convert an audio file to a supported format. */
export async function extractAudioFromVideo(
  inputBuffer: Buffer,
  mimeType: string,
  options: AudioExtractionOptions = {}
): Promise<AudioExtractionResult> {
  const isVideo = mimeType.startsWith('video/')
  const isAudio = mimeType.startsWith('audio/')

  if (isAudio && !options.outputFormat) {
    try {
      const metadata = await getAudioMetadata(inputBuffer, mimeType)
      return {
        buffer: inputBuffer,
        format: mimeType.split('/')[1] || 'unknown',
        duration: metadata.duration || 0,
        size: inputBuffer.length,
      }
    } catch {
      return {
        buffer: inputBuffer,
        format: mimeType.split('/')[1] || 'unknown',
        duration: 0,
        size: inputBuffer.length,
      }
    }
  }

  if (isVideo || options.outputFormat) {
    return convertAudioWithFfmpeg(inputBuffer, mimeType, options)
  }

  return {
    buffer: inputBuffer,
    format: options.outputFormat || mimeType.split('/')[1] || 'unknown',
    duration: 0,
    size: inputBuffer.length,
  }
}

async function convertAudioWithFfmpeg(
  inputBuffer: Buffer,
  mimeType: string,
  options: AudioExtractionOptions
): Promise<AudioExtractionResult> {
  const inputExt = getExtensionFromMimeType(mimeType)
  const outputFormat = options.outputFormat || 'mp3'

  return withTempDir('audio-ffmpeg-', async (dir) => {
    const inputFile = path.join(dir, `input.${inputExt}`)
    const outputFile = path.join(dir, `output.${outputFormat}`)
    await fs.writeFile(inputFile, inputBuffer)

    let duration = 0
    try {
      duration = (await getAudioMetadataFromFile(inputFile)).duration || 0
    } catch (error) {
      logger.warn('Failed to extract metadata:', error)
    }

    const args = ['-i', inputFile, '-f', outputFormat, '-acodec', getAudioCodec(outputFormat)]
    if (options.channels) args.push('-ac', String(options.channels))
    if (options.sampleRate) args.push('-ar', String(options.sampleRate))
    if (options.bitrate) args.push('-b:a', options.bitrate.replace(/k?$/, 'k'))
    args.push(outputFile)

    await runFfmpeg(args)
    const outputBuffer = await fs.readFile(outputFile)

    return {
      buffer: outputBuffer,
      format: outputFormat,
      duration,
      size: outputBuffer.length,
    }
  })
}

/** Read audio metadata with ffprobe. */
export async function getAudioMetadata(buffer: Buffer, mimeType: string): Promise<AudioMetadata> {
  const inputExt = getExtensionFromMimeType(mimeType)
  return withTempDir('audio-ffprobe-', async (dir) => {
    const inputFile = path.join(dir, `input.${inputExt}`)
    await fs.writeFile(inputFile, buffer)
    return getAudioMetadataFromFile(inputFile)
  })
}

interface FfprobeMetadata {
  streams?: Array<{
    bit_rate?: number | string
    channels?: number
    codec_name?: string
    codec_type?: string
    sample_rate?: number | string
  }>
  format?: {
    bit_rate?: number | string
    duration?: number | string
    format_name?: string
  }
}

async function getAudioMetadataFromFile(filePath: string): Promise<AudioMetadata> {
  let stdout: string
  try {
    ;({ stdout } = await runExecutable(
      requireFfprobe(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      {
        maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
        timeoutMs: PROBE_TIMEOUT_MS,
      }
    ))
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('FFprobe error: probe report was too large to read')
    }
    if (failure.killed) throw new Error('FFprobe error: probe exceeded the 30s limit')
    throw new Error(`FFprobe error: ${failure.stderr?.trim() || toError(error).message}`)
  }

  let metadata: FfprobeMetadata
  try {
    metadata = JSON.parse(stdout) as FfprobeMetadata
  } catch {
    throw new Error('FFprobe error: probe output was not readable')
  }

  const audioStream = metadata.streams?.find((stream) => stream.codec_type === 'audio')
  const format = metadata.format

  return {
    duration: Number(format?.duration) || 0,
    format: format?.format_name || 'unknown',
    codec: audioStream?.codec_name,
    sampleRate: toOptionalNumber(audioStream?.sample_rate),
    channels: audioStream?.channels,
    bitrate: toOptionalNumber(format?.bit_rate),
  }
}

function toOptionalNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/opus': 'opus',
  }

  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase()
  const knownExtension = mimeToExt[normalizedMimeType]
  if (knownExtension) return knownExtension

  const subtype = normalizedMimeType.split('/')[1]
  return subtype && /^[a-z0-9][a-z0-9.+_-]{0,63}$/.test(subtype) ? subtype : 'dat'
}

function getAudioCodec(format: string): string {
  const codecMap: Record<string, string> = {
    mp3: 'libmp3lame',
    wav: 'pcm_s16le',
    flac: 'flac',
    m4a: 'aac',
    aac: 'aac',
    ogg: 'libvorbis',
    opus: 'libopus',
  }

  return codecMap[format] || 'libmp3lame'
}

/** Check whether a MIME type represents video. */
export function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}

/** Check whether a MIME type represents audio. */
export function isAudioFile(mimeType: string): boolean {
  return mimeType.startsWith('audio/')
}
