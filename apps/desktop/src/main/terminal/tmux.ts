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
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { TerminalPaneState } from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'

const logger = createLogger('DesktopTmux')

/**
 * Ceiling on any single tmux invocation. These are local socket round trips
 * that normally return in milliseconds; a hang means the server is wedged, and
 * blocking a tool call on it forever is worse than reporting failure.
 */
const TMUX_TIMEOUT_MS = 5_000

/** How often the status file is checked while a tmux-run command is going. */
const RUN_POLL_INTERVAL_MS = 250

/**
 * Field separator for `-F` output. Printable on purpose: tmux 3.4 and 3.5 print a control
 * character as its octal escape, so a control-character separator arrived as the text `\037` and
 * no line split. No tmux escapes these characters. Fields are untrusted text (a directory or
 * window name can hold the separator, or a newline), so records are also framed per call: see
 * {@link framedFormat}.
 */
const FIELD = '<~sim~>'

/**
 * A `-F` format for these fields whose every record starts and ends with a marker made fresh for
 * this one call. tmux prints a newline inside a field as is, so a directory named
 * `a\nuser:0.0<~sim~>…` would otherwise end one record early and forge another. Nobody outside
 * this call knows the marker, so no field can forge a framed record, and the halves of a record a
 * newline split are each unframed and dropped.
 */
function framedFormat(fields: string[]): { format: string; frame: string } {
  const frame = `<~${randomBytes(8).toString('hex')}~>`
  return { format: `${frame}${fields.join(FIELD)}${frame}`, frame }
}

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
 * Parses `list-clients`/`list-panes` output into records: only lines framed whole by this call's
 * marker, each with exactly the fields asked for.
 *
 * Split on a dedicated separator rather than whitespace: window names and
 * working directories contain spaces, and a path with a space would otherwise
 * shift every later field by one.
 */
export function parseFormatLines(stdout: string, fields: number, frame: string): string[][] {
  return stdout
    .split('\n')
    .filter(
      (line) => line.length >= frame.length * 2 && line.startsWith(frame) && line.endsWith(frame)
    )
    .map((line) => line.slice(frame.length, line.length - frame.length).split(FIELD))
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
  const { format, frame } = framedFormat(['#{client_pid}', '#{client_tty}', '#{client_session}'])
  const listed = await runTmux(['list-clients', '-F', format], env)
  if (!listed.ok) return null

  const clients = parseFormatLines(listed.stdout, 3, frame)
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
  const { format, frame } = framedFormat(['#{session_name}:#{window_index}.#{pane_index}'])
  const result = await runTmux(['display-message', '-p', '-t', session, format], env)
  if (!result.ok) return null
  const [target] = parseFormatLines(result.stdout, 1, frame)[0] ?? []
  return target || null
}

export async function listPanes(
  session: string,
  env: NodeJS.ProcessEnv
): Promise<TerminalPaneState[]> {
  const { format, frame } = framedFormat([
    '#{session_name}:#{window_index}.#{pane_index}',
    '#{window_name}',
    '#{pane_current_command}',
    '#{pane_current_path}',
    '#{pane_active}',
  ])
  const result = await runTmux(['list-panes', '-s', '-t', session, '-F', format], env)
  if (!result.ok) return []
  return parseFormatLines(result.stdout, 5, frame).map(
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
  /** The run's own pane: input and stops go here, never to whatever pane is active. */
  pane: string
  /**
   * Tagged on the pane as the `@sim-run-id` user option. Window and pane ids restart from zero
   * with the tmux server, so only the tag proves a pane is still this run's. Null when tmux could
   * not tag the pane (tmux before 3.0 has no pane options): the run goes ahead untracked, and
   * nothing ever stops it, since nothing could tell its pane from one of the user's.
   */
  runId: string | null
  outPath: string
  statusPath: string
  dispose(): void
}

/**
 * How many 50 ms polls a run's command waits for its go file: longer than the tagging call can
 * take before it times out, so a tag that succeeds always lands inside the window.
 */
const RUN_GATE_POLLS = Math.ceil((2 * TMUX_TIMEOUT_MS + 5_000) / 50)

/** The tmux user option that marks a pane as one run's own. */
const RUN_ID_OPTION = '@sim-run-id'

/**
 * How tmux before 3.0, which has no pane options, refuses `set-option -p`. Its own getopt prints
 * `unknown option -- p` (BSD getopt on macOS: `illegal option -- p`) followed by set-option's usage
 * line; later wordings are kept for any build that phrases it so.
 */
const NO_PANE_OPTIONS =
  /unknown option -- p|illegal option -- p|usage: set-option|unknown flag|invalid option/i

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
  const goPath = join(dir, 'go')
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
  // The status write is silenced because its directory may be gone by the time
  // it runs: closing the terminal tab reclaims the run's temp dir while the
  // command keeps going in tmux. `tee` is unaffected — POSIX lets it keep
  // writing to the unlinked inode — but an unredirected `printf` would fail
  // into the pipeline and print `No such file or directory` into the user's own
  // tmux window, minutes after they closed the tab.
  //
  // The command waits for the tagging call to finish (the go file), so a tagged run's command
  // never runs before a later stop could recognize its pane. If Sim never releases it (it quit
  // mid-start), the script gives up once the tagging call has surely ended and its pane closes on
  // its own; no one has to close a pane whose id might no longer be its own.
  //
  // The script is a file rather than a `bash -c` string: tmux hands its command to `sh -c`, which
  // would expand `$` references meant for bash (the gate's counter, PIPESTATUS) before bash ran.
  const scriptPath = join(dir, 'run.sh')
  writeFileSync(
    scriptPath,
    [
      'i=0',
      `while [ ! -e ${JSON.stringify(goPath)} ] && [ "$i" -lt ${RUN_GATE_POLLS} ]; do sleep 0.05; i=$((i + 1)); done`,
      `[ -e ${JSON.stringify(goPath)} ] || exit 0`,
      `{ ${command}`,
      `printf %s "\${PIPESTATUS[0]}" > ${JSON.stringify(statusPath)} 2>/dev/null; } 2>&1 | tee ${JSON.stringify(outPath)}`,
      '',
    ].join('\n'),
    { mode: 0o600 }
  )
  const wrapper = `bash -l ${JSON.stringify(scriptPath)}`

  const args = [
    'new-window',
    '-d',
    '-P',
    '-F',
    '#{window_id} #{pane_id}',
    '-t',
    session,
    '-n',
    'sim-run',
  ]
  if (cwd) args.push('-c', cwd)
  args.push(wrapper)

  const created = await runTmux(args, env)
  if (!created.ok) {
    dispose()
    return { error: created.stderr.trim() || 'tmux could not open a window for the command.' }
  }
  const [window = '', pane = ''] = created.stdout.trim().split(' ')
  const tag = generateId()
  // An untagged pane is never treated as the run's: without the tag a stop could not tell it from
  // a pane the user opened later under the same id.
  const tagged = await runTmux(['set-option', '-p', '-t', pane, RUN_ID_OPTION, tag], env)
  if (!tagged.ok && !NO_PANE_OPTIONS.test(tagged.stderr)) {
    // A tmux that can tag panes but did not (it timed out, or failed otherwise) gets no command
    // that nothing could stop: without the go file the wrapper exits by itself.
    dispose()
    return {
      error: `tmux could not mark the command's pane (${tagged.stderr.trim() || 'no detail'}), so the command was not run.`,
    }
  }
  if (!tagged.ok) {
    logger.warn('This tmux cannot tag a run pane; the run goes ahead untracked', {
      error: tagged.stderr.trim(),
    })
  }
  const runId = tagged.ok ? tag : null
  try {
    writeFileSync(goPath, '')
  } catch (error) {
    dispose()
    return { error: `The command could not be started: ${getErrorMessage(error)}` }
  }

  return { window, pane, runId, outPath, statusPath, dispose }
}

/**
 * Whether the run's pane is still the run's: `ours`, or `gone` when tmux has no such pane or the
 * pane under that id is not tagged as this run's (the user closed it, or a restarted tmux server
 * handed the id to one of the user's own panes). `unknown` when tmux could not be asked, or an
 * untracked run's pane still exists, since nothing proves whose it is: such a pane is neither
 * touched nor given up on.
 */
export async function runPaneState(
  handle: TmuxRunHandle,
  env: NodeJS.ProcessEnv
): Promise<'ours' | 'gone' | 'unknown'> {
  if (!handle.pane) return 'gone'
  // An untracked run's pane can still be found missing, with a format every tmux knows.
  const format = handle.runId === null ? '#{pane_id}' : `#{${RUN_ID_OPTION}}`
  const shown = await runTmux(['display-message', '-p', '-t', handle.pane, format], env)
  // tmux 3.x answers for a missing pane with an empty line rather than an error.
  if (shown.ok && handle.runId === null) {
    return shown.stdout.trim() === handle.pane ? 'unknown' : 'gone'
  }
  if (shown.ok) return shown.stdout.trim() === handle.runId ? 'ours' : 'gone'
  return /can't find|no server running/i.test(shown.stderr) ? 'gone' : 'unknown'
}

/**
 * Stops a run: Ctrl-C in its own pane, then closing that pane if the command ignored it. Every
 * step first checks the pane is still the run's, and only that pane is ever closed, so a pane the
 * user split off beside it, or a window that reused its ids, is never touched.
 */
export async function stopRun(
  handle: TmuxRunHandle,
  env: NodeJS.ProcessEnv,
  graceMs: number
): Promise<void> {
  if ((await runPaneState(handle, env)) !== 'ours') return
  await sendKey(handle.pane, 'C-c', env)
  const deadline = Date.now() + graceMs
  while (!isRunComplete(handle) && Date.now() < deadline) await sleep(100)
  if (!isRunComplete(handle)) await closeRunPane(handle, env)
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
export function isRunComplete(handle: TmuxRunHandle): boolean {
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
    await sleep(Math.min(RUN_POLL_INTERVAL_MS, remaining))
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

/**
 * Whether the pane under an untracked run's id was started with that run's own script, whose path
 * is unique to the run. Every tmux reports a pane's start command, so this holds where tags do not.
 */
async function startedByRun(handle: TmuxRunHandle, env: NodeJS.ProcessEnv): Promise<boolean> {
  const script = join(dirname(handle.statusPath), 'run.sh')
  const shown = await runTmux(
    ['display-message', '-p', '-t', handle.pane, '#{pane_start_command}'],
    env
  )
  return shown.ok && shown.stdout.includes(script)
}

/**
 * Closes the pane opened by {@link startRun}, and with it the window once that pane is the last
 * one in it. Only the run's own pane, and only while it is still the run's. An untracked run's
 * pane is closed only once the run has written its exit status, and only if the pane was started
 * by the run's own script: a restarted tmux may have handed the id to one of the user's panes.
 */
export async function closeRunPane(handle: TmuxRunHandle, env: NodeJS.ProcessEnv): Promise<void> {
  const state = await runPaneState(handle, env)
  const finishedUntracked =
    handle.runId === null &&
    state === 'unknown' &&
    isRunComplete(handle) &&
    (await startedByRun(handle, env))
  if (state !== 'ours' && !finishedUntracked) return
  const killed = await runTmux(['kill-pane', '-t', handle.pane], env)
  if (!killed.ok) {
    logger.warn('Could not close the tmux run pane', { error: killed.stderr.trim() })
  }
}
