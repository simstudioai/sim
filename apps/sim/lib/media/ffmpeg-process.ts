import { execFile, execFileSync } from 'node:child_process'
import { toError } from '@sim/utils/errors'

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

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
 * Run an executable with a shell-free argument vector and bounded output.
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
