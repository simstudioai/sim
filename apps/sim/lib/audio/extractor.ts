import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'
import type {
  AudioExtractionOptions,
  AudioExtractionResult,
  AudioMetadata,
} from '@/lib/audio/types'

// Set ffmpeg binary path with fallback to system ffmpeg
try {
  if (ffmpegStatic && typeof ffmpegStatic === 'string') {
    ffmpeg.setFfmpegPath(ffmpegStatic)
  } else {
    // Try to find system ffmpeg
    try {
      const systemFfmpeg = execSync('which ffmpeg', { encoding: 'utf-8' }).trim()
      if (systemFfmpeg) {
        ffmpeg.setFfmpegPath(systemFfmpeg)
        console.log('[FFmpeg] Using system ffmpeg:', systemFfmpeg)
      }
    } catch {
      console.warn(
        '[FFmpeg] ffmpeg-static not available and system ffmpeg not found. Please install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)'
      )
    }
  }
} catch (error) {
  console.warn('[FFmpeg] Failed to set ffmpeg path:', error)
}

/**
 * Extract audio from video or convert audio format using FFmpeg
 */
export async function extractAudioFromVideo(
  inputBuffer: Buffer,
  mimeType: string,
  options: AudioExtractionOptions = {}
): Promise<AudioExtractionResult> {
  const isVideo = mimeType.startsWith('video/')
  const isAudio = mimeType.startsWith('audio/')

  // If it's already audio and no conversion needed, get metadata and return
  if (isAudio && !options.outputFormat) {
    try {
      const metadata = await getAudioMetadata(inputBuffer, mimeType)
      return {
        buffer: inputBuffer,
        format: mimeType.split('/')[1] || 'unknown',
        duration: metadata.duration || 0,
        size: inputBuffer.length,
      }
    } catch (error) {
      // If metadata extraction fails, still return the buffer
      return {
        buffer: inputBuffer,
        format: mimeType.split('/')[1] || 'unknown',
        duration: 0,
        size: inputBuffer.length,
      }
    }
  }

  // For video or audio conversion, use ffmpeg
  if (isVideo || options.outputFormat) {
    return await convertAudioWithFFmpeg(inputBuffer, mimeType, options)
  }

  // Fallback
  return {
    buffer: inputBuffer,
    format: options.outputFormat || mimeType.split('/')[1] || 'unknown',
    duration: 0,
    size: inputBuffer.length,
  }
}

/**
 * Convert audio/video using FFmpeg
 */
async function convertAudioWithFFmpeg(
  inputBuffer: Buffer,
  mimeType: string,
  options: AudioExtractionOptions
): Promise<AudioExtractionResult> {
  // Create temporary files
  const tempDir = os.tmpdir()
  const inputExt = getExtensionFromMimeType(mimeType)
  const outputFormat = options.outputFormat || 'mp3'
  const inputFile = path.join(tempDir, `ffmpeg-input-${Date.now()}.${inputExt}`)
  const outputFile = path.join(tempDir, `ffmpeg-output-${Date.now()}.${outputFormat}`)

  try {
    // Write input buffer to temporary file
    await fs.writeFile(inputFile, inputBuffer)

    // Get metadata for duration
    let duration = 0
    try {
      const metadata = await getAudioMetadataFromFile(inputFile)
      duration = metadata.duration || 0
    } catch (error) {
      // Metadata extraction failed, continue without duration
      console.warn('Failed to extract metadata:', error)
    }

    // Convert using FFmpeg
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputFile).toFormat(outputFormat).audioCodec(getAudioCodec(outputFormat))

      // Apply audio options
      if (options.channels) {
        command = command.audioChannels(options.channels)
      }
      if (options.sampleRate) {
        command = command.audioFrequency(options.sampleRate)
      }
      if (options.bitrate) {
        command = command.audioBitrate(options.bitrate)
      }

      command
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .save(outputFile)
    })

    // Read output file
    const outputBuffer = await fs.readFile(outputFile)

    return {
      buffer: outputBuffer,
      format: outputFormat,
      duration,
      size: outputBuffer.length,
    }
  } finally {
    // Clean up temporary files
    try {
      await fs.unlink(inputFile).catch(() => {})
      await fs.unlink(outputFile).catch(() => {})
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get audio metadata using ffprobe
 */
export async function getAudioMetadata(buffer: Buffer, mimeType: string): Promise<AudioMetadata> {
  const tempDir = os.tmpdir()
  const inputExt = getExtensionFromMimeType(mimeType)
  const inputFile = path.join(tempDir, `ffprobe-input-${Date.now()}.${inputExt}`)

  try {
    // Write buffer to temporary file
    await fs.writeFile(inputFile, buffer)

    // Get metadata using ffprobe
    return await getAudioMetadataFromFile(inputFile)
  } finally {
    // Clean up temporary file
    try {
      await fs.unlink(inputFile).catch(() => {})
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get audio metadata from a file path using ffprobe
 */
async function getAudioMetadataFromFile(filePath: string): Promise<AudioMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`FFprobe error: ${err.message}`))
        return
      }

      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')
      const format = metadata.format

      resolve({
        duration: format.duration || 0,
        format: format.format_name || 'unknown',
        codec: audioStream?.codec_name,
        sampleRate: audioStream?.sample_rate,
        channels: audioStream?.channels,
        bitrate: format.bit_rate ? Number(format.bit_rate) : undefined,
      })
    })
  })
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // Video
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/webm': 'webm',
    // Audio
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/opus': 'opus',
  }

  return mimeToExt[mimeType] || mimeType.split('/')[1] || 'dat'
}

/**
 * Get appropriate audio codec for output format
 */
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

/**
 * Check if a file is a video file
 */
export function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}

/**
 * Check if a file is an audio file
 */
export function isAudioFile(mimeType: string): boolean {
  return mimeType.startsWith('audio/')
}

/**
 * Get optimal audio format for STT provider
 */
export function getOptimalFormat(provider: 'whisper' | 'deepgram' | 'elevenlabs'): {
  format: 'mp3' | 'wav' | 'flac'
  sampleRate: number
  channels: 1 | 2
} {
  switch (provider) {
    case 'whisper':
      // Whisper prefers 16kHz mono
      return {
        format: 'mp3',
        sampleRate: 16000,
        channels: 1,
      }
    case 'deepgram':
      // Deepgram works well with various formats
      return {
        format: 'mp3',
        sampleRate: 16000,
        channels: 1,
      }
    case 'elevenlabs':
      // ElevenLabs format preferences
      return {
        format: 'mp3',
        sampleRate: 16000,
        channels: 1,
      }
    default:
      return {
        format: 'mp3',
        sampleRate: 16000,
        channels: 1,
      }
  }
}
