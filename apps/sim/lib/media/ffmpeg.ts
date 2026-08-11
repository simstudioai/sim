import { execFile, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import ffmpeg from 'fluent-ffmpeg'

const logger = createLogger('MediaFfmpeg')

let ffmpegInitialized = false
let ffmpegPath: string | null = null

/** Lazy system FFmpeg binary resolution, mirroring lib/audio/extractor.ts. */
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

  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
    ffmpegPath = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]
    ffmpeg.setFfmpegPath(ffmpegPath)
  } catch {
    logger.warn('[FFmpeg] No FFmpeg binary found at init time')
  }
}

/**
 * Mirrors fluent-ffmpeg's resolution order (FFPROBE_PATH, then PATH, then
 * ffmpeg's own directory) so replacing its ffprobe call does not narrow where
 * the binary may live for self-hosters.
 */
function resolveFfprobePath(): string {
  ensureFfmpeg()
  const binary = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

  const configured = process.env.FFPROBE_PATH?.trim()
  if (configured && existsSync(configured)) return configured

  if (ffmpegPath) {
    const sibling = path.join(path.dirname(ffmpegPath), binary)
    if (existsSync(sibling)) return sibling
  }
  return binary
}

/**
 * Hard bounds for a single operation. FFmpeg runs in the request-serving
 * process, so every attacker-influenced dimension needs a ceiling: an
 * unbounded input count, filter dimension, or runtime is a whole-instance
 * CPU/RAM denial of service, not a single failed request.
 */
export const MAX_FFMPEG_INPUTS = 10
export const MIN_SCALE_DIMENSION = 16
export const MAX_SCALE_DIMENSION = 4096
export const DEFAULT_FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
const PROBE_TIMEOUT_MS = 15 * 1000
const PROBE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** Names the actionable cause: the budget covers all clips, so fewer/shorter inputs is the fix. */
const TIME_BUDGET_EXCEEDED =
  'FFmpeg operation exceeded its time budget — try fewer, shorter, or lower-resolution inputs'

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

/** Execution bounds for one operation, separate from its media parameters. */
export interface FfmpegRunOptions {
  /** Aborts and SIGKILLs every process spawned for the operation. */
  signal?: AbortSignal
  /**
   * Wall-clock budget for the whole operation. Defaults to, and is capped at,
   * DEFAULT_FFMPEG_TIMEOUT_MS — a caller may shorten the ceiling, never raise it.
   */
  timeoutMs?: number
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
  weba: 'audio/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** extract_audio can only name an audio container; the rest would silently produce nothing useful. */
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus', 'weba'])

/**
 * Temp-file names are built as `${prefix}.${ext}` and joined against the temp
 * dir, so an extension carrying `/` or `..` escapes that dir once `path.join`
 * normalizes it. Both extension sources are attacker-influenced (a stored file's
 * MIME type, and the caller-supplied `format`), so neither reaches a path
 * unsanitized.
 */
const SAFE_EXT_PATTERN = /^[a-z0-9]{1,8}$/

function isSafeExt(ext: string): boolean {
  return SAFE_EXT_PATTERN.test(ext)
}

function extFromMime(mime: string): string {
  const known = MIME_TO_EXT[mime]
  if (known) return known
  const derived = (mime.split('/')[1] || '').toLowerCase()
  return isSafeExt(derived) ? derived : 'bin'
}

function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

/** Only formats with a known muxer and a safe file name may name an output. */
function resolveOutputExt(format: string, allowed?: Set<string>): string {
  const ext = String(format).trim().toLowerCase()
  const supported = allowed ?? new Set(Object.keys(EXT_TO_MIME))
  if (!isSafeExt(ext) || !EXT_TO_MIME[ext] || !supported.has(ext)) {
    throw new Error(
      `Unsupported output format "${format}". Supported: ${[...supported].join(', ')}`
    )
  }
  return ext
}

/** Scale targets land in a filter graph, where an oversized value allocates per-frame buffers. */
function resolveScaleDimension(value: number, label: 'width' | 'height'): number {
  if (!Number.isInteger(value) || value < MIN_SCALE_DIMENSION || value > MAX_SCALE_DIMENSION) {
    throw new Error(
      `${label} must be an integer between ${MIN_SCALE_DIMENSION} and ${MAX_SCALE_DIMENSION} (got ${value})`
    )
  }
  return value
}

function clampProbedDimension(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || (value as number) < MIN_SCALE_DIMENSION) return fallback
  return Math.min(value as number, MAX_SCALE_DIMENSION)
}

function resolveNonNegativeSeconds(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number of seconds (got ${value})`)
  }
  return value
}

function resolveVolume(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`${label} must be a number between 0 and 10 (got ${value})`)
  }
  return value
}

/**
 * Every caller-supplied bound is checked before a temp dir is created or a
 * binary is resolved, so a rejected request costs nothing and the error is the
 * validation failure rather than a missing-FFmpeg message.
 *
 * Only the options an operation actually consumes are validated. An LLM caller
 * routinely emits surplus parameters, and failing the whole call over a value
 * the operation ignores would be a regression, not a safeguard.
 */
function assertOptionsWithinBounds(operation: FfmpegOperation, options: FfmpegOptions): void {
  if (operation === 'trim' || operation === 'thumbnail') {
    if (options.start !== undefined) resolveNonNegativeSeconds(options.start, 'start')
  }
  if (operation === 'trim' && options.end !== undefined) {
    const end = resolveNonNegativeSeconds(options.end, 'end')
    const start = resolveNonNegativeSeconds(options.start ?? 0, 'start')
    if (end < start) {
      throw new Error(`end (${end}s) must be greater than or equal to start (${start}s)`)
    }
  }
  if (operation === 'mix_audio') {
    if (options.volume !== undefined) resolveVolume(options.volume, 'volume')
    if (options.musicVolume !== undefined) resolveVolume(options.musicVolume, 'musicVolume')
  }
  if (operation === 'convert') {
    if (!options.format) throw new Error('convert requires a target format')
    resolveOutputExt(options.format)
  }
  if (operation === 'extract_audio') {
    resolveOutputExt(options.format || 'mp3', AUDIO_EXTS)
  }
  if (operation === 'scale_pad' && options.width !== undefined && options.height !== undefined) {
    resolveScaleDimension(options.width, 'width')
    resolveScaleDimension(options.height, 'height')
  }
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

/**
 * A wall-clock budget for one whole operation, not per spawned process:
 * `concat` runs one encode per clip, so a per-command timeout would still
 * multiply out to an unbounded total. Every spawn draws from the same deadline
 * and is SIGKILLed when it expires or when the caller aborts.
 */
class OperationBudget {
  private readonly deadline: number

  constructor(
    timeoutMs: number,
    readonly signal?: AbortSignal
  ) {
    this.deadline = Date.now() + timeoutMs
  }

  remainingMs(): number {
    return this.deadline - Date.now()
  }

  assertLive(): void {
    if (this.signal?.aborted) {
      throw new Error('FFmpeg operation aborted')
    }
    if (this.remainingMs() <= 0) {
      throw new Error(TIME_BUDGET_EXCEEDED)
    }
  }
}

interface RunContext {
  dir: string
  budget: OperationBudget
}

function createBudget(runOptions: FfmpegRunOptions): OperationBudget {
  const timeoutMs =
    Number.isFinite(runOptions.timeoutMs) && (runOptions.timeoutMs as number) > 0
      ? Math.min(runOptions.timeoutMs as number, DEFAULT_FFMPEG_TIMEOUT_MS)
      : DEFAULT_FFMPEG_TIMEOUT_MS
  return new OperationBudget(timeoutMs, runOptions.signal)
}

async function withTempDir<T>(
  budget: OperationBudget,
  fn: (ctx: RunContext) => Promise<T>
): Promise<T> {
  ensureFfmpeg()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-ffmpeg-'))
  try {
    return await fn({ dir, budget })
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

function runCommand(
  command: ffmpeg.FfmpegCommand,
  outputPath: string,
  budget: OperationBudget
): Promise<void> {
  budget.assertLive()
  return new Promise<void>((resolve, reject) => {
    let settled = false

    function settle(err?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      budget.signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    /** SIGKILL, not SIGTERM: a wedged encoder must not get to ignore the signal. */
    function kill(reason: string): void {
      try {
        command.kill('SIGKILL')
      } catch {
        // The process may already be gone; the rejection below is what matters.
      }
      settle(new Error(reason))
    }
    /**
     * fluent-ffmpeg's kill() is a silent no-op until the child exists, and
     * `.save()` spawns asynchronously (it may shell out for capability checks
     * first). A kill landing in that window would otherwise reject the promise
     * while the encode goes on to spawn orphaned and unkillable — so re-issue
     * it once the process is up. 'start' fires immediately after the spawn.
     */
    function onStart(): void {
      if (settled) {
        try {
          command.kill('SIGKILL')
        } catch {
          // Nothing to signal; the promise has already settled.
        }
      }
    }
    function onAbort(): void {
      kill('FFmpeg operation aborted')
    }

    const timer = setTimeout(() => kill(TIME_BUDGET_EXCEEDED), budget.remainingMs())
    budget.signal?.addEventListener('abort', onAbort, { once: true })

    command
      .on('start', onStart)
      .on('end', () => settle())
      .on('error', (err) => settle(new Error(`FFmpeg error: ${err.message}`)))
      .save(outputPath)
  })
}

export async function probeMedia(
  file: MediaFile,
  runOptions: FfmpegRunOptions = {}
): Promise<MediaProbe> {
  const budget = createBudget(runOptions)
  return withTempDir(budget, async ({ dir }) => {
    const inputPath = await writeInput(dir, file, 0)
    return probeFile(inputPath, budget)
  })
}

interface FfprobeOutput {
  format?: { duration?: string | number; format_name?: string }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
  }>
}

/**
 * Distinguishes the three ways a probe fails. Node's `execFile` error message
 * is `Command failed: <full argv>` plus stderr, which both leaks the server's
 * binary and temp paths to the caller and — once stderr is quiet — renders a
 * timeout, a corrupt file, and a missing file byte-identical.
 */
function describeProbeFailure(err: Error & { killed?: boolean; code?: unknown }, stderr: string) {
  if (err.code === 'ABORT_ERR') return 'aborted'
  if (err.killed) return 'timed out'
  const detail = stderr.trim().split('\n').pop()
  if (!detail) return 'unreadable media'
  // ffprobe prefixes its diagnostic with the input path; keep the diagnostic,
  // drop the server's directory layout.
  return detail.replace(
    /(^|\s)(\/\S+)/g,
    (_match, lead: string, abs: string) => `${lead}${path.basename(abs)}`
  )
}

/**
 * Spawned directly rather than through `fluent-ffmpeg.ffprobe`, which gives no
 * handle on the child and so cannot be killed: a crafted input that wedges
 * ffprobe would otherwise hang forever holding a request.
 */
function probeFile(filePath: string, budget: OperationBudget): Promise<MediaProbe> {
  budget.assertLive()
  const timeout = Math.min(PROBE_TIMEOUT_MS, budget.remainingMs())
  return new Promise((resolve, reject) => {
    execFile(
      resolveFfprobePath(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', filePath],
      {
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: PROBE_MAX_OUTPUT_BYTES,
        signal: budget.signal,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`FFprobe error: ${describeProbeFailure(err, stderr)}`))
          return
        }
        let metadata: FfprobeOutput
        try {
          metadata = JSON.parse(stdout) as FfprobeOutput
        } catch {
          reject(new Error('FFprobe error: unreadable metadata'))
          return
        }
        const streams = metadata.streams ?? []
        const video = streams.find((s) => s.codec_type === 'video')
        const audio = streams.find((s) => s.codec_type === 'audio')
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
      }
    )
  })
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
  if (inputs.length > MAX_FFMPEG_INPUTS) {
    throw new Error(
      `At most ${MAX_FFMPEG_INPUTS} input files are allowed per operation (got ${inputs.length})`
    )
  }

  assertOptionsWithinBounds(operation, options)

  const budget = createBudget(runOptions)
  budget.assertLive()

  if (operation === 'probe') {
    return {
      probe: await withTempDir(budget, async ({ dir }) =>
        probeFile(await writeInput(dir, inputs[0], 0), budget)
      ),
    }
  }

  return withTempDir(budget, async (ctx) => {
    const inputPaths = await Promise.all(inputs.map((f, i) => writeInput(ctx.dir, f, i)))

    switch (operation) {
      case 'overlay_audio':
      case 'mux':
        return overlayAudio(ctx, inputPaths, options)
      case 'mix_audio':
        return mixAudio(ctx, inputPaths, options)
      case 'concat':
        return concat(ctx, inputPaths)
      case 'trim':
        return trim(ctx, inputPaths[0], inputs[0], options)
      case 'scale_pad':
        return scalePad(ctx, inputPaths[0], options)
      case 'overlay_image':
        return overlayImage(ctx, inputPaths, options)
      case 'add_text':
        return addText(ctx, inputPaths[0], options)
      case 'fade':
        return fade(ctx, inputPaths[0], inputs[0], options)
      case 'extract_audio':
        return extractAudio(ctx, inputPaths[0], options)
      case 'convert':
        return convert(ctx, inputPaths[0], options)
      case 'thumbnail':
        return thumbnail(ctx, inputPaths[0], options)
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
  { dir, budget }: RunContext,
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
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'mp4')
}

async function mixAudio(
  { dir, budget }: RunContext,
  inputPaths: string[],
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('mix_audio requires [voice, music]')
  const outputPath = path.join(dir, 'out.mp3')
  const voiceVol = resolveVolume(options.volume ?? 1, 'volume')
  const musicVol = resolveVolume(options.musicVolume ?? 0.3, 'musicVolume')
  const command = ffmpeg()
    .input(inputPaths[0])
    .input(inputPaths[1])
    .complexFilter([
      `[0:a]volume=${voiceVol}[v]`,
      `[1:a]volume=${musicVol}[m]`,
      `[v][m]amix=inputs=2:duration=longest:dropout_transition=0[a]`,
    ])
    .outputOptions(['-map', '[a]'])
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'mp3')
}

async function concat({ dir, budget }: RunContext, inputPaths: string[]): Promise<FfmpegResult> {
  if (inputPaths.length < 2) throw new Error('concat requires at least 2 clips')
  const probes = await Promise.all(inputPaths.map((p) => probeFile(p, budget)))
  probes.forEach((p, i) => {
    if (!p.hasVideo) {
      throw new Error(
        `concat input ${i} has no video stream; concat joins video clips (use mix_audio/overlay_audio for audio-only files).`
      )
    }
  })
  // Clamped, not trusted: these come from the first clip's container metadata,
  // and a crafted file can declare dimensions that make the normalize pass
  // allocate gigabytes per frame.
  const width = clampProbedDimension(probes[0].width, 1280)
  const height = clampProbedDimension(probes[0].height, 720)
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
    await runCommand(cmd, out, budget)
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
  await runCommand(concatCmd, outputPath, budget)
  return readOut(outputPath, 'mp4')
}

async function trim(
  { dir, budget }: RunContext,
  inputPath: string,
  input: MediaFile,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = extFromMime(input.mimeType)
  const outputPath = path.join(dir, `out.${ext}`)
  const start = resolveNonNegativeSeconds(options.start ?? 0, 'start')
  const command = ffmpeg(inputPath).setStartTime(start)
  if (options.end !== undefined) {
    const end = resolveNonNegativeSeconds(options.end, 'end')
    command.setDuration(Math.max(0, end - start))
  }
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, ext)
}

async function scalePad(
  { dir, budget }: RunContext,
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
  const scaleWidth = resolveScaleDimension(width, 'width')
  const scaleHeight = resolveScaleDimension(height, 'height')
  const outputPath = path.join(dir, 'out.mp4')
  const command = ffmpeg(inputPath)
    .videoFilters(
      `scale=${scaleWidth}:${scaleHeight}:force_original_aspect_ratio=decrease,pad=${scaleWidth}:${scaleHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`
    )
    .outputOptions(['-c:a', 'copy'])
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'mp4')
}

async function overlayImage(
  { dir, budget }: RunContext,
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
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'mp4')
}

async function addText(
  { dir, budget }: RunContext,
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
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'mp4')
}

async function fade(
  { dir, budget }: RunContext,
  inputPath: string,
  input: MediaFile,
  _options: FfmpegOptions
): Promise<FfmpegResult> {
  const probe = await probeFile(inputPath, budget)
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
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, ext)
}

async function extractAudio(
  { dir, budget }: RunContext,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const ext = resolveOutputExt(options.format || 'mp3')
  const outputPath = path.join(dir, `out.${ext}`)
  const command = ffmpeg(inputPath).noVideo()
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, ext)
}

async function convert(
  { dir, budget }: RunContext,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  if (!options.format) throw new Error('convert requires a target format')
  const ext = resolveOutputExt(options.format)
  const outputPath = path.join(dir, `out.${ext}`)
  await runCommand(ffmpeg(inputPath), outputPath, budget)
  return readOut(outputPath, ext)
}

async function thumbnail(
  { dir, budget }: RunContext,
  inputPath: string,
  options: FfmpegOptions
): Promise<FfmpegResult> {
  const outputPath = path.join(dir, 'out.jpg')
  const command = ffmpeg(inputPath)
    .seekInput(resolveNonNegativeSeconds(options.start ?? 0, 'start'))
    .frames(1)
  await runCommand(command, outputPath, budget)
  return readOut(outputPath, 'jpg')
}

export { extFromMime, mimeFromExt }
