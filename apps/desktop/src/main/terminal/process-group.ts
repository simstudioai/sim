/**
 * The processes running a terminal's foreground command: the whole pipeline the user would stop
 * with Ctrl-C, including its children, and never the shell itself.
 *
 * On macOS and Linux that is the tty's foreground process group. Windows has no process groups or
 * job control, so there it is the shell's child processes created since the command was typed,
 * each ended with its whole tree. Children from before then (a server the user started in the
 * background earlier) belong to someone else's work and are left running. Creation times and the
 * command's start come from the same system clock, and the shell only starts a program after it
 * reads the command, so no tolerance is needed.
 */
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { windowsPowerShellPath, windowsSystem32 } from '@/main/terminal/shell-path'

const logger = createLogger('DesktopTerminalProcessGroup')

const LOOKUP_TIMEOUT_MS = 2_000

/** Windows PowerShell takes a second or more to start on a cold machine. */
const WINDOWS_LOOKUP_TIMEOUT_MS = 5_000

/** Reads and signals what holds a terminal's foreground. */
export interface TerminalProcessGroups {
  /**
   * Ids of what runs the foreground command, which was typed into the shell at `startedAt` (epoch
   * ms): process group ids on macOS and Linux, process ids on Windows. Empty when the shell itself
   * holds the foreground (it is sitting at its prompt) or the lookup failed.
   */
  foreground(shellPid: number, startedAt: number): Promise<number[]>
  /** Those of `ids`, from an earlier {@link foreground}, that still run the foreground command. */
  stillRunning(shellPid: number, ids: number[]): Promise<number[]>
  /** Sends `signal` to each id {@link foreground} returned. */
  signal(ids: number[], signal: NodeJS.Signals): void
  /** The signals a command that ignored Ctrl-C is sent, in order, until one ends it. */
  escalations: readonly NodeJS.Signals[]
}

const POSIX_PROCESS_GROUPS: TerminalProcessGroups = {
  foreground: async (shellPid) => {
    const pgid = await readForegroundProcessGroup(shellPid)
    return pgid === null ? [] : [pgid]
  },
  stillRunning: async (shellPid, pgids) => {
    const foreground = await readForegroundProcessGroup(shellPid)
    return pgids.filter((pgid) => pgid === foreground)
  },
  signal: (pgids, signal) => {
    for (const pgid of pgids) signalProcessGroup(pgid, signal)
  },
  escalations: ['SIGTERM', 'SIGKILL'],
}

/** A Windows process, as the process table reports it. */
export interface WindowsChildProcess {
  pid: number
  /** Epoch milliseconds. */
  createdAt: number
}

/**
 * Windows, given how to list a shell's child processes. The one escalation is a forced tree kill:
 * a Windows console program cannot be asked to terminate, and Ctrl-C, the one request it can trap,
 * has already been sent.
 */
export function windowsProcessGroups(
  readChildren: (shellPid: number) => Promise<WindowsChildProcess[]>
): TerminalProcessGroups {
  return {
    foreground: async (shellPid, startedAt) =>
      (await readChildren(shellPid))
        .filter((child) => child.pid !== shellPid && child.createdAt >= startedAt)
        .map((child) => child.pid),
    stillRunning: async (_shellPid, pids) => pids.filter(isRunning),
    signal: (pids) => {
      for (const pid of pids) killProcessTree(pid)
    },
    escalations: ['SIGTERM'],
  }
}

/** This operating system's way of reading and stopping a terminal's foreground command. */
export const osProcessGroups: TerminalProcessGroups =
  process.platform === 'win32' ? windowsProcessGroups(readChildProcesses) : POSIX_PROCESS_GROUPS

/**
 * The tty's foreground process group, read from `ps`. Null when it cannot be read, or when the
 * shell itself holds the foreground.
 */
async function readForegroundProcessGroup(shellPid: number): Promise<number | null> {
  if (!isProcessId(shellPid)) return null
  const stdout = await readOutput('ps', ['-o', 'tpgid=', '-p', String(shellPid)], LOOKUP_TIMEOUT_MS)
  const pgid = Number.parseInt(stdout?.trim() ?? '', 10)
  return isProcessId(pgid) && pgid !== shellPid ? pgid : null
}

function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    logger.warn('Could not signal a terminal process group', {
      signal,
      error: getErrorMessage(error),
    })
  }
}

/** The shell's direct children, from the process table; each one's tree is what it runs. */
async function readChildProcesses(shellPid: number): Promise<WindowsChildProcess[]> {
  if (!isProcessId(shellPid)) return []
  const stdout = await readOutput(
    windowsPowerShellPath(process.env),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance -ClassName Win32_Process -Filter 'ParentProcessId=${shellPid}' | ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`,
    ],
    WINDOWS_LOOKUP_TIMEOUT_MS
  )
  return (stdout ?? '').split(/\r?\n/).flatMap((line) => {
    const [pid, createdAt] = line.trim().split(' ').map(Number)
    return isProcessId(pid) && Number.isFinite(createdAt) ? [{ pid, createdAt }] : []
  })
}

function killProcessTree(pid: number): void {
  const taskkill = win32.join(windowsSystem32(process.env), 'taskkill.exe')
  const child = spawn(taskkill, ['/T', '/F', '/PID', String(pid)], {
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', (error) => {
    logger.warn('Could not end a terminal process tree', { error: getErrorMessage(error) })
  })
}

/** Whether `pid` still names a process; signal 0 tests for one without sending anything. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isProcessId(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** A short-lived command's stdout, or null when it could not run or outlived `timeoutMs`. */
function readOutput(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let stdout = ''
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(stdout))
  })
}
