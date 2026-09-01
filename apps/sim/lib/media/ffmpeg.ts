import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { MAX_MEDIA_BYTES } from '@/lib/media/falai'
import { FFMPEG_LIMITS } from '@/lib/media/ffmpeg-limits'
import { FFMPEG_BASE_ARGS, resolveExecutable, runExecutable } from '@/lib/media/ffmpeg-process'

const logger = createLogger('MediaFfmpeg')

const INSTALL_HINT =
  'Install: brew install ffmpeg (macOS) / apk add ffmpeg (Alpine) / apt-get install ffmpeg (Ubuntu)'

/**
 * Wall-clock budget for one media operation, shared by every child process it
 * spawns. The budget is per-operation rather than per-command because `concat`
 * runs a full re-encode per input: a per-command timeout would let N inputs
 * multiply into N timeouts on a CPU-bound instance that serves every other
 * request at the same time.
 */
const OPERATION_TIMEOUT_MS = 10 * 60 * 1000

/** Per-probe ceiling, additionally bounded by whatever remains of the operation budget. */
const PROBE_TIMEOUT_MS = 30 * 1000

/** Headroom for ffprobe's JSON report on a container with many streams. */
const PROBE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

const {
  minScaleDimension: MIN_SCALE_DIMENSION,
  maxScaleDimension: MAX_SCALE_DIMENSION,
  maxScalePixels: MAX_SCALE_PIXELS,
} = FFMPEG_LIMITS

let binariesInitialized = false
let ffmpegPath: string | null = null
let ffprobePath: string | null = null

function resolveBinary(binary: string): string | null {
  return resolveExecutable(binary)
}

/** Lazy system FFmpeg binary resolution, mirroring lib/audio/extractor.ts. */
function ensureFfmpeg(): void {
  if (!binariesInitialized) {
    binariesInitialized = true
    ffmpegPath = resolveBinary('ffmpeg')
    ffprobePath = resolveBinary('ffprobe')
    if (!ffmpegPath) logger.warn('[FFmpeg] No FFmpeg binary found at init time')
  }
  if (!ffmpegPath) throw new Error(`FFmpeg not found. ${INSTALL_HINT}`)
}

function ensureFfprobe(): string {
  ensureFfmpeg()
  if (!ffprobePath) throw new Error(`FFprobe not found. ${INSTALL_HINT}`)
  return ffprobePath
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

export interface FfmpegRunOptions {
  /**
   * Kills the running child process when the caller cancels. Copilot's tool
   * signal fires only on an explicit user stop, never on a passive transport
   * disconnect, so a wired encode stops when the user asks and not before.
   */
  signal?: AbortSignal
}

/** Per-operation execution bounds, shared by every child process the operation spawns. */
interface FfmpegRunContext {
  /** Absolute wall-clock deadline for the whole operation. */
  deadlineAt: number
  signal?: AbortSignal
}

const CANCELLED_MESSAGE = 'FFmpeg cancelled'

function timedOutMessage(): string {
  return `FFmpeg exceeded the ${Math.round(OPERATION_TIMEOUT_MS / 1000)}s media operation limit. Use shorter inputs, fewer clips, or a smaller target size.`
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
  const normalizedMime = mime.split(';', 1)[0].trim().toLowerCase()
  const knownExtension = MIME_TO_EXT[normalizedMime]
  if (knownExtension) return knownExtension

  const subtype = normalizedMime.split('/')[1]
  return subtype && /^[a-z0-9][a-z0-9.+_-]{0,63}$/.test(subtype) ? subtype : 'bin'
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

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  ensureFfmpeg()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-ffmpeg-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Extensions this module will build an output path from: letters and digits only.
 *
 * `format` reaches the tool as an unconstrained string and is the one
 * caller-controlled value that becomes a path. Because the pattern admits no `.`
 * and no separator, `out.${ext}` is always a single path segment, so the joined
 * path cannot leave the temp directory — the containment is the pattern, not a
 * second check that could drift away from it.
 */
const OUTPUT_EXT_PATTERN = /^[a-z0-9]{1,12}$/

/**
 * Resolve a temp-dir output path for a caller-supplied extension.
 *
 * Unvalidated, `path.join(dir, 'out.' + '../../../../tmp/x.mp4')` resolves to
 * `/tmp/x.mp4`: FFmpeg writes wherever the traversal points, the bytes are
 * attacker-influenced media, and the temp-directory cleanup never sees the file
 * because it was never inside the directory being removed.
 */
function outputPathForExt(dir: string, ext: string): string {
  if (!OUTPUT_EXT_PATTERN.test(ext)) {
    throw new Error(
      `Unsupported output format "${ext}" — use a plain extension such as mp4, mp3, wav, or gif`
    )
  }
  return path.join(dir, `out.${ext}`)
}

async function writeInput(dir: string, file: MediaFile, index: number): Promise<string> {
  const ext = extFromMime(file.mimeType)
  const filePath = path.join(dir, `in-${index}.${ext}`)
  await fs.writeFile(filePath, file.buffer)
  return filePath
}

/**
 * Run one FFmpeg command under the operation's deadline and cancellation signal.
 *
 * Without this, a transcode has no bound at all: `.save()` resolves whenever
 * FFmpeg happens to finish, so a long input or an oversized filter graph pins
 * the instance's cores for as long as it likes and survives the request that
 * asked for it.
 */
async function runCommand(
  ctx: FfmpegRunContext,
  args: string[],
  outputPath: string,
  cwd?: string
): Promise<void> {
  if (ctx.signal?.aborted) throw new Error(CANCELLED_MESSAGE)
  const remaining = ctx.deadlineAt - Date.now()
  if (remaining <= 0) throw new Error(timedOutMessage())

  ensureFfmpeg()
  try {
    await runExecutable(ffmpegPath as string, [...FFMPEG_BASE_ARGS, ...args, outputPath], {
      cwd,
      maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
      signal: ctx.signal,
      timeoutMs: remaining,
    })
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
    if (failure.name === 'AbortError' || ctx.signal?.aborted) {
      throw new Error(CANCELLED_MESSAGE)
    }
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('FFmpeg error: process output was too large to read')
    }
    if (failure.killed) throw new Error(timedOutMessage())
    throw new Error(`FFmpeg error: ${failure.stderr?.trim() || toError(error).message}`)
  }
}

interface FfprobeReport {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
  }>
  format?: { duration?: string | number; format_name?: string }
}

/**
 * Probe through the shared `execFile` boundary so the child is killed on a
 * deadline or cancellation and its diagnostic output is bounded. `concat`
 * probes once per input, so an unbounded prober would scale with the request.
 */
async function probeFile(ctx: FfmpegRunContext, filePath: string): Promise<MediaProbe> {
  const binary = ensureFfprobe()
  const timeout = Math.min(PROBE_TIMEOUT_MS, ctx.deadlineAt - Date.now())
  if (timeout <= 0) throw new Error(timedOutMessage())

  let stdout: string
  try {
    ;({ stdout } = await runExecutable(
      binary,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      {
        timeoutMs: timeout,
        maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
        signal: ctx.signal,
      }
    ))
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
    if (failure.name === 'AbortError') throw new Error(CANCELLED_MESSAGE)
    // Node kills the child for an oversized report too, so check that before
    // reading `killed` as "we ran out of time".
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error('FFprobe error: probe report was too large to read')
    }
    if (failure.killed) throw new Error(timedOutMessage())
    throw new Error(`FFprobe error: ${failure.stderr?.trim() || failure.message}`)
  }

  let report: FfprobeReport
  try {
    report = JSON.parse(stdout) as FfprobeReport
  } catch {
    throw new Error('FFprobe error: probe output was not readable')
  }

  const streams = report.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  return {
    durationSeconds: Number(report.format?.duration) || 0,
    format: report.format?.format_name || 'unknown',
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
  }
}

/**
 * Run a single FFmpeg media operation on the provided input files.
 * All inputs/outputs are buffers; temp files are created and cleaned up internally.
 */
export async function runFfmpegOperation(
  operation: FfmpegOperation,
  inputs: MediaFile[],
  options: FfmpegOptions = {},
  runOptions: FfmpegRunOptions = {}
): Promise<FfmpegResult> {
  if (inputs.length === 0) {
    throw new Error('At least one input file is required')
  }

  const ctx: FfmpegRunContext = {
    deadlineAt: Date.now() + OPERATION_TIMEOUT_MS,
    signal: runOptions.signal,
  }

  if (operation === 'probe') {
    return withTempDir(async (dir) => ({
      probe: await probeFile(ctx, await writeInput(dir, inputs[0], 0)),
    }))
  }

  return withTempDir(async (dir) => {
    const inputPaths = await Promise.all(inputs.map((f, i) => writeInput(dir, f, i)))

    switch (operation) {
      case 'overlay_audio':
      case 'mux':
        return overlayAudio(ctx, dir, inputPaths, options)
      case 'mix_audio':
        return mixAudio(ctx, dir, inputPaths, options)
      case 'concat':
        return concat(ctx, dir, inputPaths)
      case 'trim':
        return trim(ctx, dir, inputPaths[0], inputs[0], options)
      case 'scale_pad':
        return scalePad(ctx, dir, inputPaths[0], options)
      case 'overlay_image':
        return overlayImage(ctx, dir, inputPaths, options)
      case 'add_text':
        return addText(ctx, dir, inputPaths[0], options)
      case 'fade':
        return fade(ctx, dir, inputPaths[0], inputs[0], options)
      case 'extract_audio':
        return extractAudio(ctx, dir, inputPaths[0], options)
      case 'convert':
        return convert(ctx, dir, inputPaths[0], options)
      case 'thumbnail':
        return thumbnail(ctx, dir, inputPaths[0], options)
      default:
        throw new Error(`Unsupported ffmpeg operation: ${operation}`)
    }
  })
}

/**
 * Size the output before buffering it. The input budget does not bound this:
 * `concat` re-encodes at CRF 18 and `convert` can target a lossless format, so
 * a bounded input routinely produces a much larger output.
 */
async function readOut(outputPath: string, ext: string): Promise<FfmpegResult> {
  const { size } = await fs.stat(outputPath)
  if (size > MAX_MEDIA_BYTES) {
    throw new Error(
      `FFmpeg produced ${size} bytes, above the ${MAX_MEDIA_BYTES} byte media limit. Use a shorter input or a smaller target size.`
    )
  }
  const buffer = await fs.readFile(outputPath)
  return { buffer, ext, contentType: mimeFromExt(ext) }
}

async function overlayAudio(
  ctx: FfmpegRunContext,
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('overlay_audio requires [video, audio]')
  const outputPath = path.join(dir, 'out.mp4')
  const args = ['-i', inputPaths[0]]
  if (options.loopToVideo) {
    args.push('-stream_loop', '-1', '-i', inputPaths[1])
  } else {
    args.push('-i', inputPaths[1])
  }
  args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest')
  await runCommand(ctx, args, outputPath)
  return readOut(outputPath, 'mp4')
}

async function mixAudio(
  ctx: FfmpegRunContext,
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('mix_audio requires [voice, music]')
  const outputPath = path.join(dir, 'out.mp3')
  const voiceVol = options.volume ?? 1
  const musicVol = options.musicVolume ?? 0.3
  const filter = [
    `[0:a]volume=${voiceVol}[v]`,
    `[1:a]volume=${musicVol}[m]`,
    `[v][m]amix=inputs=2:duration=longest:dropout_transition=0[a]`,
  ].join(';')
  await runCommand(
    ctx,
    ['-i', inputPaths[0], '-i', inputPaths[1], '-filter_complex', filter, '-map', '[a]'],
    outputPath
  )
  return readOut(outputPath, 'mp3')
}

async function concat(
  ctx: FfmpegRunContext,
  dir: string,
  inputPaths: string[]
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('concat requires at least 2 clips')
  const probes = await Promise.all(inputPaths.map((p) => probeFile(ctx, p)))
  probes.forEach((p, i) => {
    if (!p.hasVideo) {
      throw new Error(
        `concat input ${i} has no video stream; concat joins video clips (use mix_audio/overlay_audio for audio-only files).`
      )
    }
  })
  // Clamped, not rejected: these describe the caller's own file rather than a
  // value they asserted, but a container is free to declare a frame size far
  // larger than anything worth normalizing to.
  const { width, height } = clampProbedFrame(probes[0].width || 1280, probes[0].height || 720)
  const fps = 30

  // Normalize every clip to identical codec/size/fps/pixfmt, and SYNTHESIZE silent
  // audio for clips that have no audio stream. Clips generated without native audio
  // (generateAudio:false) otherwise break the concat filtergraph (it referenced a
  // non-existent [i:a]), which is the "Error binding filtergraph inputs/outputs" failure.
  const normalized: string[] = []
  for (let i = 0; i < inputPaths.length; i++) {
    const out = path.join(dir, `norm-${i}.mp4`)
    const args = ['-i', inputPaths[i]]
    const maps: string[] = ['-map', '0:v:0']
    const extra: string[] = []
    if (probes[i].hasAudio) {
      maps.push('-map', '0:a:0')
    } else {
      args.push(
        '-f',
        'lavfi',
        '-t',
        String(probes[i].durationSeconds || 1),
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000'
      )
      maps.push('-map', '1:a:0')
      extra.push('-shortest')
    }
    args.push(
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`,
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
      ...extra
    )
    await runCommand(ctx, args, out)
    normalized.push(out)
  }

  // Concatenate the now-uniform clips with the concat demuxer (stream copy: fast + reliable).
  const listPath = path.join(dir, 'concat-list.txt')
  await fs.writeFile(
    listPath,
    normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  )
  const outputPath = path.join(dir, 'out.mp4')
  await runCommand(
    ctx,
    ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart'],
    outputPath
  )
  return readOut(outputPath, 'mp4')
}

async function trim(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  input: MediaFile,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = extFromMime(input.mimeType)
  const outputPath = path.join(dir, `out.${ext}`)
  const start = options.start ?? 0
  // Output-side -ss (after -i) preserves fluent-ffmpeg's setStartTime
  // semantics: frame-accurate trim starts instead of keyframe-snapped ones.
  const args = ['-i', inputPath, '-ss', String(start)]
  if (options.end !== undefined) {
    args.push('-t', String(Math.max(0, options.end - start)))
  }
  await runCommand(ctx, args, outputPath)
  return readOut(outputPath, ext)
}

/**
 * Fit a probed source frame inside the same budget `scale_pad` enforces.
 *
 * Clamping each axis on its own is not enough: two axes at the per-axis ceiling
 * are 4096x4096, nearly double the area limit, and that target is baked into the
 * same `scale=`/`pad=` graph. Scale the pair down together instead, so aspect
 * ratio survives and one ceiling governs both entry points.
 *
 * Dimensions come back even because the normalization encodes yuv420p, which
 * has no odd-sized frame.
 */
function clampProbedFrame(width: number, height: number): { width: number; height: number } {
  let w = clampProbedAxis(width)
  let h = clampProbedAxis(height)
  const area = w * h
  if (area > MAX_SCALE_PIXELS) {
    const ratio = Math.sqrt(MAX_SCALE_PIXELS / area)
    w = clampProbedAxis(w * ratio)
    h = clampProbedAxis(h * ratio)
  }
  return { width: w, height: h }
}

/**
 * Floors rather than rounds, which is what makes the area bound hold.
 *
 * The scale factor lands both axes on a product of exactly the budget, so any
 * axis allowed to round *up* can put the pair back over it — and when both round
 * up and both land even, nothing pulls them back. Flooring keeps each axis at or
 * below its exact target, so the product cannot exceed the budget. Probed
 * dimensions are already integers, so this only ever bites on the scaled path.
 */
function clampProbedAxis(value: number): number {
  const bounded = Math.min(Math.max(Math.floor(value), MIN_SCALE_DIMENSION), MAX_SCALE_DIMENSION)
  return bounded - (bounded % 2)
}

function resolveScaleDimension(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`scale_pad ${label} must be a finite number`)
  }
  const rounded = Math.round(value)
  if (rounded < MIN_SCALE_DIMENSION || rounded > MAX_SCALE_DIMENSION) {
    throw new Error(
      `scale_pad ${label} must be between ${MIN_SCALE_DIMENSION} and ${MAX_SCALE_DIMENSION} pixels (received ${rounded})`
    )
  }
  return rounded
}

/**
 * Bound the scale targets before they reach the filter graph. libavfilter sizes
 * its per-frame buffers from these numbers, so an unbounded pair — `scale=30000:30000`
 * is ~2.7 GB a frame — is a multi-gigabyte allocation in a child process that
 * shares the instance's memory, for every frame of the input.
 */
async function scalePad(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  let requestedWidth = options.width
  let requestedHeight = options.height
  if (
    (!requestedWidth || !requestedHeight) &&
    options.aspectRatio &&
    ASPECT_TARGETS[options.aspectRatio]
  ) {
    requestedWidth = ASPECT_TARGETS[options.aspectRatio].w
    requestedHeight = ASPECT_TARGETS[options.aspectRatio].h
  }
  if (!requestedWidth || !requestedHeight) {
    throw new Error('scale_pad requires width+height or a known aspectRatio (e.g. 9:16)')
  }
  const width = resolveScaleDimension(requestedWidth, 'width')
  const height = resolveScaleDimension(requestedHeight, 'height')
  if (width * height > MAX_SCALE_PIXELS) {
    throw new Error(
      `scale_pad ${width}x${height} is ${width * height} pixels, above the ${MAX_SCALE_PIXELS} pixel limit (4K). Choose a smaller frame`
    )
  }

  const outputPath = path.join(dir, 'out.mp4')
  await runCommand(
    ctx,
    [
      '-i',
      inputPath,
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      '-c:a',
      'copy',
    ],
    outputPath
  )
  return readOut(outputPath, 'mp4')
}

async function overlayImage(
  ctx: FfmpegRunContext,
  dir: string,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('overlay_image requires [video, image]')
  const xy = OVERLAY_POSITION[options.position || 'top-right'] || OVERLAY_POSITION['top-right']
  const outputPath = path.join(dir, 'out.mp4')
  await runCommand(
    ctx,
    [
      '-i',
      inputPaths[0],
      '-i',
      inputPaths[1],
      '-filter_complex',
      `[0:v][1:v]overlay=${xy}[v]`,
      '-map',
      '[v]',
      '-map',
      '0:a?',
      '-c:a',
      'copy',
    ],
    outputPath
  )
  return readOut(outputPath, 'mp4')
}

async function addText(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (!options.text) throw new Error('add_text requires text')
  const pos = TEXT_POSITION[options.position || 'bottom'] || TEXT_POSITION.bottom
  // Route the caption out-of-band through a file the operation owns; never inline it into
  // the filtergraph. Inline escaping is not safe — FFmpeg's av_get_token copies bytes
  // verbatim inside a single-quoted run, so a literal quote closes the quote and the rest
  // of the caption is parsed as filtergraph syntax, injecting filters like
  // `textfile=/proc/self/environ` or `movie=http\://...` (arbitrary local-file read +
  // read-SSRF, CWE-88). `textfile=` renders the bytes literally and `expansion=none`
  // disables drawtext's `%{...}` functions, so the caption can never re-enter the parser.
  //
  // Reference the caption by a bare relative filename and run FFmpeg with its working
  // directory set to the temp dir. FFmpeg's filtergraph tokenizer cannot round-trip a
  // single quote inside a `textfile=` value — it drops or mis-parses it — so embedding the
  // absolute temp path would break add_text whenever `os.tmpdir()` contains a quote (e.g. a
  // Windows profile like `C:\Users\O'Brien\...`). The working directory is handed to the
  // process via execve, never parsed as filtergraph syntax, so any character in it is safe.
  const captionFileName = 'caption.txt'
  await fs.writeFile(path.join(dir, captionFileName), options.text, 'utf-8')
  const drawtext = [
    `textfile=${captionFileName}`,
    'expansion=none',
    'reload=0',
    'fontcolor=white',
    'fontsize=h/18',
    'box=1',
    'boxcolor=black@0.5',
    'boxborderw=20',
    `x=${pos.x}`,
    `y=${pos.y}`,
  ].join(':')
  const outputPath = path.join(dir, 'out.mp4')
  await runCommand(
    ctx,
    ['-i', inputPath, '-vf', `drawtext=${drawtext}`, '-c:a', 'copy'],
    outputPath,
    dir
  )
  return readOut(outputPath, 'mp4')
}

async function fade(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  input: MediaFile,
  _options: FfmpegOptions
): Promise<FfmpegResult> {
  const probe = await probeFile(ctx, inputPath)
  const duration = probe.durationSeconds || 0
  const fadeDur = Math.min(0.5, duration / 4 || 0.5)
  const outStart = Math.max(0, duration - fadeDur)
  const isVideo = input.mimeType.startsWith('video/') || probe.hasVideo
  const ext = isVideo ? 'mp4' : extFromMime(input.mimeType)
  const outputPath = path.join(dir, `out.${ext}`)
  const args = ['-i', inputPath]
  if (isVideo) {
    args.push(
      '-vf',
      [`fade=t=in:st=0:d=${fadeDur}`, `fade=t=out:st=${outStart}:d=${fadeDur}`].join(',')
    )
  }
  args.push(
    '-af',
    [`afade=t=in:st=0:d=${fadeDur}`, `afade=t=out:st=${outStart}:d=${fadeDur}`].join(',')
  )
  await runCommand(ctx, args, outputPath)
  return readOut(outputPath, ext)
}

async function extractAudio(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = (options.format || 'mp3').toLowerCase()
  const outputPath = outputPathForExt(dir, ext)
  await runCommand(ctx, ['-i', inputPath, '-vn'], outputPath)
  return readOut(outputPath, ext)
}

async function convert(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (!options.format) throw new Error('convert requires a target format')
  const ext = options.format.toLowerCase()
  const outputPath = outputPathForExt(dir, ext)
  await runCommand(ctx, ['-i', inputPath], outputPath)
  return readOut(outputPath, ext)
}

async function thumbnail(
  ctx: FfmpegRunContext,
  dir: string,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const outputPath = path.join(dir, 'out.jpg')
  await runCommand(
    ctx,
    ['-ss', String(options.start ?? 0), '-i', inputPath, '-frames:v', '1'],
    outputPath
  )
  return readOut(outputPath, 'jpg')
}

export { extFromMime, mimeFromExt }
