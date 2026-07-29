/**
 * Reads a running process's working directory from the OS.
 *
 * The shell announces `cd` through its shell-integration hooks, but only when
 * those hooks are installed — a shell we cannot instrument (fish, nushell), a
 * config that clobbers the prompt hooks, or a shell started before the hooks
 * loaded leaves the reported directory frozen at spawn. Asking the OS for the
 * shell's real cwd needs no cooperation from the shell at all, so it is the
 * source of truth the tab title falls back on. This mirrors how VS Code
 * resolves a terminal's cwd (`lsof` on macOS, procfs on Linux).
 */
import { spawn } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { createLogger } from '@sim/logger'

const logger = createLogger('DesktopTerminalProcessCwd')

/** A hung `lsof` must never wedge the poller; the call is best-effort. */
const LOOKUP_TIMEOUT_MS = 2_000

/**
 * The current working directory of `pid`, or null when it cannot be resolved
 * (process gone, permission denied, unsupported platform). Never throws.
 */
export async function readProcessCwd(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'linux') return readProcCwd(pid)
  if (process.platform === 'darwin') return readLsofCwd(pid)
  return null
}

/** Linux: the kernel exposes the cwd as a symlink, so no subprocess is needed. */
async function readProcCwd(pid: number): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/**
 * macOS has no procfs, so the cwd comes from `lsof`. The query is narrowed to
 * one process and one descriptor (`-a -d cwd -p <pid>`) and asks for field
 * output (`-Fn`), which prints `n<path>` — far cheaper than an unfiltered
 * `lsof` that would enumerate every open file on the system.
 */
function readLsofCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      logger.warn('Could not run lsof for terminal cwd', { error: (error as Error).message })
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
    }, LOOKUP_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(parseLsofCwd(stdout)))
  })
}

/**
 * Picks the path out of `lsof -Fn` field output, whose lines are a one-letter
 * field type followed by the value (`n/Users/me/project`).
 */
export function parseLsofCwd(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    if (line.startsWith('n/')) return line.slice(1)
  }
  return null
}
