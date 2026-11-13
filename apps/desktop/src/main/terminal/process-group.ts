/**
 * The processes running a terminal's foreground command: the whole pipeline the user would stop
 * with Ctrl-C, including its children, and never the shell itself.
 *
 * On macOS and Linux that is the tty's foreground process group. Windows has no process groups or
 * job control, so there it is the processes the shell started since the command was typed, each
 * ended with its whole tree. A launcher can stand between the pty and the real shell (Git for
 * Windows' `bin\bash.exe` starts `usr\bin\bash.exe`), so the shell is followed down that chain
 * first. Every other process from before the command (a server the user started in the background
 * earlier, and anything that server starts later) is someone else's and is left running. Creation
 * times and the command's start come from the same system clock, and the shell only starts a
 * program after it reads the command, so no tolerance is needed there.
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
   * holds the foreground (it is sitting at its prompt, or has exited); null when the OS could not
   * be asked, so anything may be running. `shellReadyAt` is when the shell began running its
   * startup file, or null when it never announced it: anything it started before then is the
   * shell itself.
   */
  foreground(
    shellPid: number,
    startedAt: number,
    shellReadyAt: number | null
  ): Promise<number[] | null>
  /** Those of `ids`, from an earlier {@link foreground}, that still run the foreground command. */
  stillRunning(shellPid: number, ids: number[]): Promise<number[]>
  /** Sends `signal` to each id {@link foreground} returned. */
  signal(ids: number[], signal: NodeJS.Signals): void
  /** The signals a command that ignored Ctrl-C is sent, in order, until one ends it. */
  escalations: readonly NodeJS.Signals[]
  /**
   * Whether a command's ids are read before it is sent Ctrl-C rather than once Ctrl-C has failed.
   * The tty's foreground is cheap to read and names the command only while it runs: once Ctrl-C
   * lands, the shell's own prompt work (a `git status` for the prompt) can take the tty in its
   * own group. A Windows lookup starts PowerShell and is scoped by creation time instead, so it
   * waits until an escalation is actually needed.
   */
  readBeforeInterrupt: boolean
}

const POSIX_PROCESS_GROUPS: TerminalProcessGroups = {
  foreground: readForegroundProcessGroup,
  stillRunning: async (shellPid, pgids) => {
    const foreground = (await readForegroundProcessGroup(shellPid)) ?? []
    return pgids.filter((pgid) => foreground.includes(pgid))
  },
  signal: (pgids, signal) => {
    for (const pgid of pgids) signalProcessGroup(pgid, signal)
  },
  escalations: ['SIGTERM', 'SIGKILL'],
  readBeforeInterrupt: true,
}

/** A Windows process, as the process table reports it. */
export interface WindowsProcess {
  pid: number
  parentPid: number
  /** Epoch milliseconds. */
  createdAt: number
}

/**
 * The processes a command typed at `startedAt` started, each standing for its whole tree: the
 * children created since then of the shell and of the real shell behind any launcher. A launcher's
 * real shell is its first child, created before the shell began running its startup file at
 * `shellReadyAt`, when no command can have run yet. Other older children are earlier background
 * work, so nothing beneath them is the command's, even a worker they start while it runs.
 */
function commandRoots(
  table: WindowsProcess[],
  shellPid: number,
  startedAt: number,
  shellReadyAt: number | null
): number[] {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]))
  const children = new Map<number, WindowsProcess[]>()
  for (const entry of table) {
    if (entry.pid === entry.parentPid) continue
    children.set(entry.parentPid, [...(children.get(entry.parentPid) ?? []), entry])
  }
  const roots: number[] = []
  const visited = new Set<number>()
  for (let shell = byPid.get(shellPid); shell && !visited.has(shell.pid); ) {
    visited.add(shell.pid)
    const own = children.get(shell.pid) ?? []
    for (const child of own) if (child.createdAt >= startedAt) roots.push(child.pid)
    const first = own.reduce<WindowsProcess | undefined>(
      (oldest, child) => (!oldest || child.createdAt < oldest.createdAt ? child : oldest),
      undefined
    )
    const launched = first && shellReadyAt !== null && first.createdAt <= shellReadyAt
    shell = launched ? first : undefined
  }
  return roots
}

/**
 * Windows, given how to read the process table. The one escalation is a forced tree kill: a
 * Windows console program cannot be asked to terminate, and Ctrl-C, the one request it can trap,
 * has already been sent.
 */
export function windowsProcessGroups(
  readProcesses: () => Promise<WindowsProcess[] | null>
): TerminalProcessGroups {
  return {
    foreground: async (shellPid, startedAt, shellReadyAt) => {
      const table = await readProcesses()
      return table && commandRoots(table, shellPid, startedAt, shellReadyAt)
    },
    stillRunning: async (_shellPid, pids) => pids.filter(isRunning),
    signal: (pids) => {
      for (const pid of pids) killProcessTree(pid)
    },
    escalations: ['SIGTERM'],
    readBeforeInterrupt: false,
  }
}

/** This operating system's way of reading and stopping a terminal's foreground command. */
export const osProcessGroups: TerminalProcessGroups =
  process.platform === 'win32' ? windowsProcessGroups(readProcessTable) : POSIX_PROCESS_GROUPS

/** The tty's foreground process group, read from `ps`, as {@link TerminalProcessGroups.foreground}. */
async function readForegroundProcessGroup(shellPid: number): Promise<number[] | null> {
  if (!isProcessId(shellPid)) return null
  const result = await readOutput('ps', ['-o', 'tpgid=', '-p', String(shellPid)], LOOKUP_TIMEOUT_MS)
  if (!result) return null
  const output = result.stdout.trim()
  // `ps` matching nothing is a shell that has exited, so nothing can be running in it; the pid is
  // confirmed gone so that a probe failing some other way stays unknown.
  if (result.code === 1 && !output) return isRunning(shellPid) ? null : []
  if (result.code !== 0 || !output) return null
  const pgid = Number.parseInt(output, 10)
  if (!Number.isInteger(pgid)) return null
  return pgid <= 0 || pgid === shellPid ? [] : [pgid]
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

async function readProcessTable(): Promise<WindowsProcess[] | null> {
  const result = await readOutput(
    windowsPowerShellPath(process.env),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance -ClassName Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }',
    ],
    WINDOWS_LOOKUP_TIMEOUT_MS
  )
  if (result?.code !== 0) return null
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const [pid, parentPid, createdAt] = line.trim().split(' ').map(Number)
    return isProcessId(pid) && Number.isInteger(parentPid) && Number.isFinite(createdAt)
      ? [{ pid, parentPid, createdAt }]
      : []
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

interface CommandOutput {
  code: number | null
  stdout: string
}

/** A short-lived command's exit code and stdout, or null when it could not run or outlived `timeoutMs`. */
function readOutput(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<CommandOutput | null> {
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
    const finish = (value: CommandOutput | null) => {
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
    child.on('close', (code) => finish({ code, stdout }))
  })
}
