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
 * The tty's foreground process group, read from `ps`. Null when it cannot be read, or when the
 * shell itself holds the foreground (it is sitting at its prompt).
 */
export function readForegroundProcessGroup(shellPid: number): Promise<number | null> {
  if (!Number.isInteger(shellPid) || shellPid <= 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('ps', ['-o', 'tpgid=', '-p', String(shellPid)], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolve(null)
      return
    }
    let stdout = ''
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, LOOKUP_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      const pgid = Number.parseInt(stdout.trim(), 10)
      finish(Number.isInteger(pgid) && pgid > 0 && pgid !== shellPid ? pgid : null)
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
