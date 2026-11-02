import { execFile, execFileSync } from 'node:child_process'
import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

/**
 * Base flags for every ffmpeg invocation. `-y`/`-nostdin` replace
 * fluent-ffmpeg's implicit overwrite flag: without them an existing output
 * makes ffmpeg prompt on an unread stdin pipe and hang until the timeout
 * kills it.
 */
const FFMPEG_BASE_ARGS = ['-y', '-nostdin'] as const

/**
 * Inputs are always files this process wrote, so they may open local files and
 * nothing else; a container that names a URL (a playlist, a reference movie)
 * fails instead of reaching the network. The option applies to the input that
 * follows it.
 */
const INPUT_PROTOCOL_WHITELIST = ['-protocol_whitelist', 'file,pipe'] as const

/**
 * Demuxers an input may probe as: media containers that read only the bytes
 * they are given. FFmpeg picks the demuxer from content, not the file name, and
 * the bytes are user-supplied, so without this an upload can select a demuxer
 * that opens further local paths (`concat`, `hls`, `dash`, `imf`) and the only
 * barrier left is that demuxer's own upstream defaults. Any other input fails
 * with "Format not on whitelist" before the demuxer opens anything.
 */
const MEDIA_DEMUXERS = [
  'mov',
  'matroska',
  'avi',
  'flv',
  'asf',
  'mpegts',
  'mpeg',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'aiff',
  'amr',
  'caf',
  'png_pipe',
  'jpeg_pipe',
  'webp_pipe',
  'gif',
  'image2',
].join(',')

/**
 * FFmpeg argv: base flags, then `args` with the protocol and format whitelists
 * before every input. A demuxer the caller forces with `-f` (the concat list,
 * the `lavfi` silence source) is added to that input's format whitelist, so
 * the inputs it opens in turn are still held to media demuxers.
 */
export function ffmpegArgs(args: readonly string[]): string[] {
  const argv: string[] = [...FFMPEG_BASE_ARGS]
  let forcedDemuxer: string | undefined
  for (const [index, arg] of args.entries()) {
    if (arg === '-f') forcedDemuxer = args[index + 1]
    if (arg === '-i') {
      const formats = forcedDemuxer ? `${forcedDemuxer},${MEDIA_DEMUXERS}` : MEDIA_DEMUXERS
      argv.push(...INPUT_PROTOCOL_WHITELIST, '-format_whitelist', formats)
      forcedDemuxer = undefined
    }
    argv.push(arg)
  }
  return argv
}

/** FFprobe argv that prints the format and streams of `filePath` as JSON. */
export function ffprobeJsonArgs(filePath: string): string[] {
  return [
    ...INPUT_PROTOCOL_WHITELIST,
    '-format_whitelist',
    MEDIA_DEMUXERS,
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]
}

export interface ExecutableOptions {
  cwd?: string
  maxOutputBytes?: number
  signal?: AbortSignal
  timeoutMs: number
}

export interface ExecutableResult {
  stdout: string
  stderr: string
}

/** Resolve an executable without invoking a shell. */
export function resolveExecutable(binary: string): string | null {
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const stdout = execFileSync(locator, [binary], { encoding: 'utf-8' })
    return stdout.trim().split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

/**
 * The environment a media tool runs with: what it needs to find its libraries
 * and fonts, never the variables this process was configured with.
 */
function executableEnv(): NodeJS.ProcessEnv {
  const allowed = filterUndefined({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FONTCONFIG_FILE: process.env.FONTCONFIG_FILE,
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
  })
  return { ...allowed, NODE_ENV: process.env.NODE_ENV }
}

/**
 * Run an executable with a shell-free argument vector, a minimal environment,
 * and bounded output.
 *
 * `execFile` owns the timeout and abort handling, including killing the child.
 * `maxBuffer` bounds both stdout and stderr, which prevents FFmpeg diagnostics
 * from growing with an adversarial or badly corrupted input.
 */
export function runExecutable(
  executable: string,
  args: string[],
  options: ExecutableOptions
): Promise<ExecutableResult> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        executable,
        args,
        {
          cwd: options.cwd,
          encoding: 'utf-8',
          env: executableEnv(),
          killSignal: 'SIGKILL',
          maxBuffer: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
          signal: options.signal,
          timeout: options.timeoutMs,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stderr, stdout }))
            return
          }
          resolve({ stdout, stderr })
        }
      )
    } catch (error) {
      reject(toError(error))
    }
  })
}
