import { execSync } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'

const logger = createLogger('MediaFfmpeg')

let ffmpegInitialized = false
let ffmpegPath: string | null = null

/** Lazy FFmpeg binary resolution (ffmpeg-static, then system), mirroring lib/audio/extractor.ts. */
function ensureFfmpeg(): void {
  if (ffmpegInitialized) {
    if (!ffmpegPath) {
      throw new Error(
        'FFmpeg not found. Install: brew install ffmpeg (macOS) / apk add ffmpeg (Alpine) / apt-get install ffmpeg (Ubuntu)'
      )
    }
    return
  }
  ffmpegInitialized = true

  if (ffmpegStatic && typeof ffmpegStatic === 'string') {
    try {
      fsSync.accessSync(ffmpegStatic, fsSync.constants.X_OK)
      ffmpegPath = ffmpegStatic
      ffmpeg.setFfmpegPath(ffmpegPath)
      return
    } catch {
      // fall through to system ffmpeg
    }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
    ffmpegPath = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]
    ffmpeg.setFfmpegPath(ffmpegPath)
  } catch {
    logger.warn('[FFmpeg] No FFmpeg binary found at init time')
  }
}

export type FfmpegOperation =
  | 'overlay_audio'
  | 'mux'
  | 'mix_audio'
  | 'concat'
  | 'trim'
  | 'scale_pad'
  | 'overlay_image'
  | 'add_text'
  | 'fade'
  | 'extract_audio'
  | 'convert'
  | 'thumbnail'
  | 'probe'

export interface MediaFile {
  buffer: Buffer
  mimeType: string
  name?: string
}

export interface FfmpegOptions {
  text?: string
  position?: string
  start?: number
  end?: number
  width?: number
  height?: number
  aspectRatio?: string
  volume?: number
  musicVolume?: number
  loopToVideo?: boolean
  format?: string
}

export interface MediaProbe {
  durationSeconds: number
  format: string
  width?: number
  height?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio: boolean
  hasVideo: boolean
}

export interface FfmpegResult {
  buffer?: Buffer
  contentType?: string
  ext?: string
  probe?: MediaProbe
}

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/mpeg': 'mp4',
  'video/quicktime': 'mov',
  'video/x-quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aac': 'aac',
  'audio/opus': 'opus',
  'audio/webm': 'weba',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
}

function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] || mime.split('/')[1] || 'bin'
}

function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

const ASPECT_TARGETS: Record<string, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:3': { w: 1440, h: 1080 },
  '3:4': { w: 1080, h: 1440 },
  '4:5': { w: 1080, h: 1350 },
  '21:9': { w: 2560, h: 1080 },
}

const OVERLAY_POSITION: Record<string, string> = {
  'top-left': '10:10',
  top: '(W-w)/2:10',
  'top-right': 'W-w-10:10',
  center: '(W-w)/2:(H-h)/2',
  'bottom-left': '10:H-h-10',
  bottom: '(W-w)/2:H-h-10',
  'bottom-right': 'W-w-10:H-h-10',
}

const TEXT_POSITION: Record<string, { x: string; y: string }> = {
  top: { x: '(w-text_w)/2', y: 'h*0.08' },
  center: { x: '(w-text_w)/2', y: '(h-text_h)/2' },
  bottom: { x: '(w-text_w)/2', y: 'h*0.86' },
  'top-left': { x: 'w*0.05', y: 'h*0.08' },
  'top-right': { x: 'w*0.95-text_w', y: 'h*0.08' },
  'bottom-left': { x: 'w*0.05', y: 'h*0.86' },
  'bottom-right': { x: 'w*0.95-text_w', y: 'h*0.86' },
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%')
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  ensureFfmpeg()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-ffmpeg-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function writeInput(dir: string, file: MediaFile, index: number): Promise<string> {
  const ext = extFromMime(file.mimeType)
  const filePath = path.join(dir, `in-${index}.${ext}`)
  await fs.writeFile(filePath, file.buffer)
  return filePath
}

function runCommand(command: ffmpeg.FfmpegCommand, outputPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    command
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .save(outputPath)
  })
}

export async function probeMedia(file: MediaFile): Promise<MediaProbe> {
  return withTempDir(async (dir) => {
    const inputPath = await writeInput(dir, file, 0)
    return probeFile(inputPath)
  })
}

function probeFile(filePath: string): Promise<MediaProbe> {
  ensureFfmpeg()
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`FFprobe error: ${err.message}`))
        return
      }
      const video = metadata.streams.find((s) => s.codec_type === 'video')
      const audio = metadata.streams.find((s) => s.codec_type === 'audio')
      resolve({
        durationSeconds: Number(metadata.format?.duration) || 0,
        format: metadata.format?.format_name || 'unknown',
        width: video?.width,
        height: video?.height,
        videoCodec: video?.codec_name,
        audioCodec: audio?.codec_name,
        hasAudio: Boolean(audio),
        hasVideo: Boolean(video),
      })
    })
  })
}

/**
 * Run a single FFmpeg media operation on the provided input files.
 * All inputs/outputs are buffers; temp files are created and cleaned up internally.
 */
export async function runFfmpegOperation(
  operation: FfmpegOperation,
  inputs: MediaFile[],
  options: FfmpegOptions = {}
): Promise<FfmpegResult> {
  if (inputs.length === 0) {
    throw new Error('At least one input file is required')
  }

  if (operation === 'probe') {
    return { probe: await probeMedia(inputs[0]) }
  }

  return withTempDir(async (dir) => {
    const inputPaths = await Promise.all(inputs.map((f, i) => writeInput(dir, f, i)))

    switch (operation) {
      case 'overlay_audio':
      case 'mux':
        return overlayAudio(dir, inputPaths, options)
      case 'mix_audio':
        return mixAudio(dir, inputPaths, options)
      case 'concat':
        return concat(dir, inputPaths)
      case 'trim':
        return trim(dir, inputPaths[0], inputs[0], options)
      case 'scale_pad':
        return scalePad(dir, inputPaths[0], options)
      case 'overlay_image':
        return overlayImage(dir, inputPaths, options)
      case 'add_text':
        return addText(dir, inputPaths[0], options)
      case 'fade':
        return fade(dir, inputPaths[0], inputs[0], options)
      case 'extract_audio':
        return extractAudio(dir, inputPaths[0], options)
      case 'convert':
        return convert(dir, inputPaths[0], options)
      case 'thumbnail':
        return thumbnail(dir, inputPaths[0], options)
      default:
        throw new Error(`Unsupported ffmpeg operation: ${operation}`)
    }
  })
}

async function readOut(outputPath: string, ext: string): Promise<FfmpegResult> {
  const buffer = await fs.readFile(outputPath)
  return { buffer, ext, contentType: mimeFromExt(ext) }
}

async function overlayAudio(
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('overlay_audio requires [video, audio]')
  const outputPath = path.join(dir, 'out.mp4')
  const command = ffmpeg().input(inputPaths[0])
  if (options.loopToVideo) {
    command.input(inputPaths[1]).inputOptions(['-stream_loop', '-1'])
  } else {
    command.input(inputPaths[1])
  }
  command.outputOptions([
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
  ])
  await runCommand(command, outputPath)
  return readOut(outputPath, 'mp4')
}

async function mixAudio(
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('mix_audio requires [voice, music]')
  const outputPath = path.join(dir, 'out.mp3')
  const voiceVol = options.volume ?? 1
  const musicVol = options.musicVolume ?? 0.3
  const command = ffmpeg()
    .input(inputPaths[0])
    .input(inputPaths[1])
    .complexFilter([
      `[0:a]volume=${voiceVol}[v]`,
      `[1:a]volume=${musicVol}[m]`,
      `[v][m]amix=inputs=2:duration=longest:dropout_transition=0[a]`,
    ])
    .outputOptions(['-map', '[a]'])
  await runCommand(command, outputPath)
  return readOut(outputPath, 'mp3')
}

async function concat(dir: string, inputPaths: string[]): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('concat requires at least 2 clips')
  const probes = await Promise.all(inputPaths.map(probeFile))
  probes.forEach((p, i) => {
    if (!p.hasVideo) {
      throw new Error(
        `concat input ${i} has no video stream; concat joins video clips (use mix_audio/overlay_audio for audio-only files).`
      )
    }
  })
  const width = probes[0].width || 1280
  const height = probes[0].height || 720
  const fps = 30

  // Normalize every clip to identical codec/size/fps/pixfmt, and SYNTHESIZE silent
  // audio for clips that have no audio stream. Clips generated without native audio
  // (generateAudio:false) otherwise break the concat filtergraph (it referenced a
  // non-existent [i:a]), which is the "Error binding filtergraph inputs/outputs" failure.
  const normalized: string[] = []
  for (let i = 0; i < inputPaths.length; i++) {
    const out = path.join(dir, `norm-${i}.mp4`)
    const cmd = ffmpeg().input(inputPaths[i])
    const maps: string[] = ['-map', '0:v:0']
    const extra: string[] = []
    if (probes[i].hasAudio) {
      maps.push('-map', '0:a:0')
    } else {
      cmd
        .input('anullsrc=channel_layout=stereo:sample_rate=48000')
        .inputOptions(['-f', 'lavfi', '-t', String(probes[i].durationSeconds || 1)])
      maps.push('-map', '1:a:0')
      extra.push('-shortest')
    }
    cmd
      .videoFilters(
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
      )
      .outputOptions([
        ...maps,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-video_track_timescale',
        '90000',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        ...extra,
      ])
    await runCommand(cmd, out)
    normalized.push(out)
  }

  // Concatenate the now-uniform clips with the concat demuxer (stream copy: fast + reliable).
  const listPath = path.join(dir, 'concat-list.txt')
  await fs.writeFile(
    listPath,
    normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  )
  const outputPath = path.join(dir, 'out.mp4')
  const concatCmd = ffmpeg()
    .input(listPath)
    .inputOptions(['-f', 'concat', '-safe', '0'])
    .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
  await runCommand(concatCmd, outputPath)
  return readOut(outputPath, 'mp4')
}

async function trim(
  dir: string,
  inputPath: string,
  input: MediaFile,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = extFromMime(input.mimeType)
  const outputPath = path.join(dir, `out.${ext}`)
  const start = options.start ?? 0
  const command = ffmpeg(inputPath).setStartTime(start)
  if (options.end !== undefined) {
    command.setDuration(Math.max(0, options.end - start))
  }
  await runCommand(command, outputPath)
  return readOut(outputPath, ext)
}

async function scalePad(
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  let width = options.width
  let height = options.height
  if ((!width || !height) && options.aspectRatio && ASPECT_TARGETS[options.aspectRatio]) {
    width = ASPECT_TARGETS[options.aspectRatio].w
    height = ASPECT_TARGETS[options.aspectRatio].h
  }
  if (!width || !height) {
    throw new Error('scale_pad requires width+height or a known aspectRatio (e.g. 9:16)')
  }
  const outputPath = path.join(dir, 'out.mp4')
  const command = ffmpeg(inputPath)
    .videoFilters(
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
    )
    .outputOptions(['-c:a', 'copy'])
  await runCommand(command, outputPath)
  return readOut(outputPath, 'mp4')
}

async function overlayImage(
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('overlay_image requires [video, image]')
  const xy = OVERLAY_POSITION[options.position || 'top-right'] || OVERLAY_POSITION['top-right']
  const outputPath = path.join(dir, 'out.mp4')
  const command = ffmpeg()
    .input(inputPaths[0])
    .input(inputPaths[1])
    .complexFilter([`[0:v][1:v]overlay=${xy}[v]`])
    .outputOptions(['-map', '[v]', '-map', '0:a?', '-c:a', 'copy'])
  await runCommand(command, outputPath)
  return readOut(outputPath, 'mp4')
}

async function addText(
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (!options.text) throw new Error('add_text requires text')
  const pos = TEXT_POSITION[options.position || 'bottom'] || TEXT_POSITION.bottom
  const drawtext = [
    `text='${escapeDrawtext(options.text)}'`,
    'fontcolor=white',
    'fontsize=h/18',
    'box=1',
    'boxcolor=black@0.5',
    'boxborderw=20',
    `x=${pos.x}`,
    `y=${pos.y}`,
  ].join(':')
  const outputPath = path.join(dir, 'out.mp4')
  const command = ffmpeg(inputPath)
    .videoFilters(`drawtext=${drawtext}`)
    .outputOptions(['-c:a', 'copy'])
  await runCommand(command, outputPath)
  return readOut(outputPath, 'mp4')
}

async function fade(
  dir: string,
  inputPath: string,
  input: MediaFile,
  _options: FfmpegOptions
): Promise<FfmpegResult> {
  const probe = await probeFile(inputPath)
  const duration = probe.durationSeconds || 0
  const fadeDur = Math.min(0.5, duration / 4 || 0.5)
  const outStart = Math.max(0, duration - fadeDur)
  const isVideo = input.mimeType.startsWith('video/') || probe.hasVideo
  const ext = isVideo ? 'mp4' : extFromMime(input.mimeType)
  const outputPath = path.join(dir, `out.${ext}`)
  const command = ffmpeg(inputPath)
  if (isVideo) {
    command.videoFilters([`fade=t=in:st=0:d=${fadeDur}`, `fade=t=out:st=${outStart}:d=${fadeDur}`])
  }
  command.audioFilters([`afade=t=in:st=0:d=${fadeDur}`, `afade=t=out:st=${outStart}:d=${fadeDur}`])
  await runCommand(command, outputPath)
  return readOut(outputPath, ext)
}

async function extractAudio(
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = (options.format || 'mp3').toLowerCase()
  const outputPath = path.join(dir, `out.${ext}`)
  const command = ffmpeg(inputPath).noVideo()
  await runCommand(command, outputPath)
  return readOut(outputPath, ext)
}

async function convert(
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (!options.format) throw new Error('convert requires a target format')
  const ext = options.format.toLowerCase()
  const outputPath = path.join(dir, `out.${ext}`)
  await runCommand(ffmpeg(inputPath), outputPath)
  return readOut(outputPath, ext)
}

async function thumbnail(
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const outputPath = path.join(dir, 'out.jpg')
  const command = ffmpeg(inputPath)
    .seekInput(options.start ?? 0)
    .frames(1)
  await runCommand(command, outputPath)
  return readOut(outputPath, 'jpg')
}

export { extFromMime, mimeFromExt }
