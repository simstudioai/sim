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

/** FFmpeg argv: base flags, then `args` with the protocol whitelist before every input. */
export function ffmpegArgs(args: readonly string[]): string[] {
  return [
    ...FFMPEG_BASE_ARGS,
    ...args.flatMap((arg) => (arg === '-i' ? [...INPUT_PROTOCOL_WHITELIST, arg] : [arg])),
  ]
}

/** FFprobe argv that prints the format and streams of `filePath` as JSON. */
export function ffprobeJsonArgs(filePath: string): string[] {
  return [
    ...INPUT_PROTOCOL_WHITELIST,
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
