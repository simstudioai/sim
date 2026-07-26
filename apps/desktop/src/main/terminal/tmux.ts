/**
 * tmux support for the agent terminal.
 *
 * When a user runs tmux in one of Sim's shells, the agent goes blind: tmux is
 * itself a terminal emulator, so it parses its children's output and re-renders
 * it, and the OSC 633 markers our shell integration relies on never reach us.
 * Command boundaries, exit codes, and the working directory all disappear
 * behind a full-screen program.
 *
 * tmux does expose all of it through its own CLI, though, so this module talks
 * to the tmux server directly instead of guessing at the screen. Every call is
 * a short-lived child process sharing the shell's environment, which is what
 * points it at the same socket the user's client is on.
 *
 * The tab-to-session mapping goes through process ids: node-pty gives us the
 * shell's pid, tmux reports each client's pid, and the client is a descendant
 * of the shell that launched it.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { TerminalPaneState } from '@sim/terminal-protocol'

const logger = createLogger('DesktopTmux')

/**
 * Ceiling on any single tmux invocation. These are local socket round trips
 * that normally return in milliseconds; a hang means the server is wedged, and
 * blocking a tool call on it forever is worse than reporting failure.
 */
const TMUX_TIMEOUT_MS = 5_000

/** How often the status file is checked while a tmux-run command is going. */
const RUN_POLL_INTERVAL_MS = 250

/** Field separator for `-F` output. Chosen because no tmux field contains it. */
const FIELD = '\u001f'

export interface TmuxCommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export interface TmuxRunOutcome {
  output: string
  /** Null while the command is still going. */
  exitCode: number | null
  done: boolean
}

/** A shell's tmux attachment, resolved from its pid. */
export interface TmuxAttachment {
  session: string
  clientTty: string
}

/**
 * Runs one tmux command. Never throws: a missing binary, a dead server, and a
 * bad target all arrive as `ok: false` with tmux's own message, which is more
 * useful to the model than an exception.
 */
/**
 * Set once a `tmux` spawn fails with ENOENT: the binary is not installed, and
 * it will not appear mid-session, so every later call short-circuits instead
 * of paying a failed spawn. Most machines running this have no tmux at all,
 * and without this every terminal tool call spawned a doomed process.
 */
let tmuxBinaryMissing = false

export function isTmuxUnavailable(): boolean {
  return tmuxBinaryMissing
}

export function runTmux(args: string[], env: NodeJS.ProcessEnv): Promise<TmuxCommandResult> {
  return new Promise((resolve) => {
    if (tmuxBinaryMissing) {
      resolve({ ok: false, stdout: '', stderr: 'tmux is not installed' })
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('tmux', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: (error as Error).message })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: TmuxCommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, stdout, stderr: 'tmux did not respond' })
    }, TMUX_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') tmuxBinaryMissing = true
      finish({ ok: false, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      finish({ ok: code === 0, stdout, stderr })
    })
  })
}

/**
 * Parses `list-clients`/`list-panes` output into records.
 *
 * Split on a control character rather than whitespace: window names and
 * working directories contain spaces, and a path with a space would otherwise
 * shift every later field by one.
 */
export function parseFormatLines(stdout: string, fields: number): string[][] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD))
    .filter((parts) => parts.length === fields)
}

/**
 * Builds the pid -> parent pid map used to decide whether a tmux client
 * belongs to one of our shells. One `ps` call rather than one per candidate:
 * the client is usually a direct child, but a wrapper (`exec tmux` from an rc
 * file, a login shell in between) can put it further down.
 */
export function parseProcessParents(psOutput: string): Map<number, number> {
  const parents = new Map<number, number>()
  for (const line of psOutput.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/)
    const childId = Number(pid)
    const parentId = Number(ppid)
    if (Number.isInteger(childId) && Number.isInteger(parentId)) {
      parents.set(childId, parentId)
    }
  }
  return parents
}

/**
 * Whether `pid` is `ancestor` or descends from it. Bounded rather than
 * following the chain to init, so a cycle in malformed `ps` output cannot spin.
 */
export function isDescendantOf(
  pid: number,
  ancestor: number,
  parents: Map<number, number>
): boolean {
  let current = pid
  for (let hops = 0; hops < 32; hops += 1) {
    if (current === ancestor) return true
    const parent = parents.get(current)
    if (parent === undefined || parent <= 1) return false
    current = parent
  }
  return false
}

function listProcessParents(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    const child = spawn('ps', ['-Ao', 'pid=,ppid='], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => resolve(new Map()))
    child.on('close', () => resolve(parseProcessParents(out)))
  })
}

/**
 * Finds the tmux session attached in the shell with `shellPid`, or null when
 * that shell is not running tmux.
 *
 * Matching on the client's pid rather than its tty because node-pty exposes
 * the shell's pid but not the pty's device path, and the client's tty is only
 * comparable if we already know ours.
 */
export async function resolveAttachment(
  shellPid: number,
  env: NodeJS.ProcessEnv
): Promise<TmuxAttachment | null> {
  const format = ['#{client_pid}', '#{client_tty}', '#{client_session}'].join(FIELD)
  const listed = await runTmux(['list-clients', '-F', format], env)
  if (!listed.ok) return null

  const clients = parseFormatLines(listed.stdout, 3)
  if (clients.length === 0) return null

  const parents = await listProcessParents()
  for (const [clientPid, clientTty, session] of clients) {
    const pid = Number(clientPid)
    if (!Number.isInteger(pid)) continue
    if (isDescendantOf(pid, shellPid, parents)) {
      return { session, clientTty }
    }
  }
  return null
}

/** The active pane of a session, as a target usable by every other call. */
export async function activePane(session: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await runTmux(
    ['display-message', '-p', '-t', session, '#{session_name}:#{window_index}.#{pane_index}'],
    env
  )
  const target = result.stdout.trim()
  return result.ok && target ? target : null
}

export async function listPanes(
  session: string,
  env: NodeJS.ProcessEnv
): Promise<TerminalPaneState[]> {
  const format = [
    '#{session_name}:#{window_index}.#{pane_index}',
    '#{window_name}',
    '#{pane_current_command}',
    '#{pane_current_path}',
    '#{pane_active}',
  ].join(FIELD)
  const result = await runTmux(['list-panes', '-s', '-t', session, '-F', format], env)
  if (!result.ok) return []
  return parseFormatLines(result.stdout, 5).map(
    ([target, windowName, command, cwd, active]): TerminalPaneState => ({
      target,
      windowName,
      command,
      cwd: cwd || null,
      active: active === '1',
    })
  )
}

/** Captures a pane's visible screen plus `lines` of scrollback above it. */
export async function capturePane(
  target: string,
  lines: number,
  env: NodeJS.ProcessEnv
): Promise<TmuxCommandResult> {
  return runTmux(['capture-pane', '-p', '-t', target, '-S', `-${Math.max(0, lines)}`], env)
}

/**
 * Types into a pane. `-l` sends the text literally, so a command containing
 * something like `C-c` is typed rather than interpreted as a key.
 */
export async function sendText(
  target: string,
  text: string,
  env: NodeJS.ProcessEnv
): Promise<TmuxCommandResult> {
  return runTmux(['send-keys', '-t', target, '-l', '--', text], env)
}

/** Presses a key in a pane, using tmux's key names (`Enter`, `C-c`, `Up`). */
export async function sendKey(
  target: string,
  key: string,
  env: NodeJS.ProcessEnv
): Promise<TmuxCommandResult> {
  return runTmux(['send-keys', '-t', target, key], env)
}

/** Control keys as tmux names them, for `input` against a pane. */
export const TMUX_KEY_NAMES: Record<string, string> = {
  'ctrl-c': 'C-c',
  'ctrl-d': 'C-d',
  'ctrl-z': 'C-z',
  enter: 'Enter',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  escape: 'Escape',
  tab: 'Tab',
}

/**
 * A command running in its own tmux window, with its output and exit status
 * landing in files rather than being scraped off the screen.
 */
export interface TmuxRunHandle {
  window: string
  outPath: string
  statusPath: string
  dispose(): void
}

/**
 * Starts a command in a dedicated tmux window.
 *
 * The window is the user's to watch — this is their tmux session, so work Sim
 * does should be visible in it rather than hidden. Output is teed so it both
 * scrolls on screen and lands in a file, and the exit status is written
 * separately once the pipeline finishes.
 *
 * Deliberately not built on `tmux wait-for`: that is a rendezvous rather than
 * a latch, so a command that finishes before the waiter starts leaves the wait
 * blocked forever. A file appearing has no such race.
 */
export async function startRun(
  session: string,
  command: string,
  cwd: string | null,
  env: NodeJS.ProcessEnv
): Promise<TmuxRunHandle | { error: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'sim-tmux-run-'))
  const outPath = join(dir, 'out')
  const statusPath = join(dir, 'status')
  const dispose = () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Temp dir; the OS reclaims it.
    }
  }

  // PIPESTATUS keeps the command's own exit code rather than tee's, which is
  // always 0. bash rather than the user's shell because PIPESTATUS is not
  // portable and this wrapper is ours, not something they have to read.
  const script = `${command}\nprintf %s "\${PIPESTATUS[0]}" > ${JSON.stringify(statusPath)}`
  const wrapper = `bash -lc ${JSON.stringify(`{ ${script}; } 2>&1 | tee ${JSON.stringify(outPath)}`)}`

  const args = ['new-window', '-d', '-P', '-F', '#{window_id}', '-t', session, '-n', 'sim-run']
  if (cwd) args.push('-c', cwd)
  args.push(wrapper)

  const created = await runTmux(args, env)
  if (!created.ok) {
    dispose()
    return { error: created.stderr.trim() || 'tmux could not open a window for the command.' }
  }

  return { window: created.stdout.trim(), outPath, statusPath, dispose }
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Reads a run's current output and, once written, its exit code. */
export function pollRun(handle: TmuxRunHandle): TmuxRunOutcome {
  const status = readIfPresent(handle.statusPath)
  const output = readIfPresent(handle.outPath) ?? ''
  if (status === null) {
    return { output, exitCode: null, done: false }
  }
  const exitCode = Number.parseInt(status.trim(), 10)
  return { output, exitCode: Number.isNaN(exitCode) ? null : exitCode, done: true }
}

/**
 * Whether the run has finished, decided from the tiny status file alone.
 *
 * The command's output file grows without bound and `tee` appends to it for
 * the whole run, so reading it every poll — as reading the full outcome did —
 * meant re-reading and decoding everything printed so far several times a
 * second, quadratic in output size. Liveness only needs the status file, which
 * is a few bytes; the output is read once, when the run is settled.
 */
function isRunComplete(handle: TmuxRunHandle): boolean {
  return readIfPresent(handle.statusPath) !== null
}

/**
 * Waits for a run to finish, up to `waitMs`. Returns as soon as the status
 * file appears; a command still going when the window elapses comes back
 * undone, for the caller to report as running and poll again later. The full
 * output is read only once, on the terminating poll.
 */
export async function awaitRun(handle: TmuxRunHandle, waitMs: number): Promise<TmuxRunOutcome> {
  const deadline = Date.now() + waitMs
  for (;;) {
    if (isRunComplete(handle)) return pollRun(handle)
    const remaining = deadline - Date.now()
    if (remaining <= 0) return pollRun(handle)
    await new Promise((resolve) => setTimeout(resolve, Math.min(RUN_POLL_INTERVAL_MS, remaining)))
  }
}

/**
 * Closes a pane, taking whatever runs in it with it.
 *
 * The way to be rid of a program that will not take an interrupt — a coding
 * agent, an editor with unsaved state, anything that treats Ctrl-C as "cancel
 * the current thing" rather than "quit". tmux tidies up after it: emptying a
 * window closes the window, and emptying the last window ends the session.
 */
export async function killPane(target: string, env: NodeJS.ProcessEnv): Promise<TmuxCommandResult> {
  return runTmux(['kill-pane', '-t', target], env)
}

/** Closes a window opened by {@link startRun}. */
export async function closeRunWindow(handle: TmuxRunHandle, env: NodeJS.ProcessEnv): Promise<void> {
  if (!handle.window) return
  const killed = await runTmux(['kill-window', '-t', handle.window], env)
  if (!killed.ok) {
    logger.warn('Could not close the tmux run window', { error: killed.stderr.trim() })
  }
}
