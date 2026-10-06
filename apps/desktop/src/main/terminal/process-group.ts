/**
 * Signals whatever program holds a terminal's foreground: the process group the terminal's tty
 * currently delivers keyboard signals to. That is the whole pipeline the user would stop with
 * Ctrl-C, including its children, and never the shell itself.
 */
import { spawn } from 'node:child_process'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DesktopTerminalProcessGroup')

const LOOKUP_TIMEOUT_MS = 2_000

/** The tty's foreground process group id, read from `ps`; null when it cannot be read. */
function readForegroundProcessGroup(shellPid: number): Promise<number | null> {
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
      finish(Number.isInteger(pgid) && pgid > 0 ? pgid : null)
    })
  })
}

/**
 * Sends `signal` to the terminal's foreground process group. A shell sitting at its prompt is its
 * own foreground group, so there is nothing to signal and the shell is left running.
 */
export async function signalForegroundProcessGroup(
  shellPid: number,
  signal: NodeJS.Signals
): Promise<void> {
  if (!Number.isInteger(shellPid) || shellPid <= 0) return
  const pgid = await readForegroundProcessGroup(shellPid)
  if (pgid === null || pgid === shellPid) return
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    logger.warn('Could not signal the terminal foreground process group', {
      signal,
      error: getErrorMessage(error),
    })
  }
}
