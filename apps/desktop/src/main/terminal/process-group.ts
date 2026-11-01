/**
 * The process group a terminal's tty currently delivers keyboard signals to: the whole pipeline
 * the user would stop with Ctrl-C, including its children, and never the shell itself.
 */
import { spawn } from 'node:child_process'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DesktopTerminalProcessGroup')

const LOOKUP_TIMEOUT_MS = 2_000

/**
 * Who holds a terminal's foreground: the shell at its prompt (or a shell that has already
 * exited), another process group, or `unknown` when the OS could not be asked.
 */
export type ForegroundProcessGroup =
  | { kind: 'shell' }
  | { kind: 'group'; pgid: number }
  | { kind: 'unknown' }

const SHELL: ForegroundProcessGroup = { kind: 'shell' }
const UNKNOWN: ForegroundProcessGroup = { kind: 'unknown' }

/**
 * The tty's foreground process group, read from `ps`. A pid `ps` no longer knows is a shell
 * that has exited, so nothing can be running in it. Windows has no `ps` or tty process groups,
 * so a Windows shell always reads as holding its own foreground.
 */
export function readForegroundProcessGroup(shellPid: number): Promise<ForegroundProcessGroup> {
  if (process.platform === 'win32') return Promise.resolve(SHELL)
  if (!Number.isInteger(shellPid) || shellPid <= 0) return Promise.resolve(UNKNOWN)
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('ps', ['-o', 'tpgid=', '-p', String(shellPid)], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolve(UNKNOWN)
      return
    }
    let stdout = ''
    let settled = false
    const finish = (value: ForegroundProcessGroup) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(UNKNOWN)
    }, LOOKUP_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => finish(UNKNOWN))
    child.on('close', (code) => {
      const output = stdout.trim()
      if (code !== 0 || !output) {
        finish(code === 1 && !output ? SHELL : UNKNOWN)
        return
      }
      const pgid = Number.parseInt(output, 10)
      if (!Number.isInteger(pgid)) finish(UNKNOWN)
      else if (pgid <= 0 || pgid === shellPid) finish(SHELL)
      else finish({ kind: 'group', pgid })
    })
  })
}

/** Sends `signal` to every process in one group. */
export function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    logger.warn('Could not signal a terminal process group', {
      signal,
      error: getErrorMessage(error),
    })
  }
}
