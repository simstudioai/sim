/**
 * The PTY session behind the agent terminal.
 *
 * One `node-pty` process, shared by the user and the agent, so `cd`, exported
 * variables, and scrollback are common to both. The session owns output
 * batching, the scrollback ring buffer, and the command lifecycle derived from
 * shell-integration markers.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from '@lydell/node-pty'
import { spawn } from '@lydell/node-pty'
import { createLogger } from '@sim/logger'
import {
  MAX_CAPTURE_CHARS,
  MAX_SCROLLBACK_CHARS,
  MAX_TOOL_OUTPUT_CHARS,
  PROMPT_IDLE_MS,
  type TerminalCommandEvent,
  type TerminalControlKey,
  type TerminalReadResult,
  type TerminalRunResult,
  type TerminalTabState,
} from '@sim/terminal-protocol'
import {
  Terminal as HeadlessTerminal,
  type IBuffer,
  type IBufferCell,
  type IBufferLine,
} from '@xterm/headless'
import { readProcessCwd } from '@/main/terminal/process-cwd'
import {
  buildShellLaunch,
  createNonce,
  detectShell,
  ShellIntegrationParser,
} from '@/main/terminal/shell-integration'

const logger = createLogger('DesktopTerminalSession')

/**
 * Output is batched rather than forwarded per chunk. A command like `yes` or
 * `cat` on a large file emits far faster than the renderer can paint, and one
 * IPC message per chunk locks up the UI process.
 */
const FLUSH_INTERVAL_MS = 8

/**
 * When this much unflushed output has accumulated, the pty is paused until the
 * next flush. Without it a runaway process grows the pending buffer without
 * bound between ticks.
 */
const PAUSE_HIGH_WATER_CHARS = 512 * 1024

/**
 * How far a retained buffer may overshoot its limit before being trimmed.
 *
 * Trimming to the exact limit means copying the entire buffer on every chunk
 * once it is full — a quarter of a megabyte per chunk, hundreds of times a
 * second under heavy output, on the process that also feeds the renderer.
 * That copying is what makes the panel stutter while something is printing.
 * Letting the buffer overshoot and trimming in one go amortizes it to a single
 * copy per slack-sized batch.
 */
const TRIM_SLACK_CHARS = 64_000

/** Control keys mapped to the bytes a terminal actually sends. */
const CONTROL_KEY_BYTES: Record<TerminalControlKey, string> = {
  'ctrl-c': '\u0003',
  'ctrl-d': '\u0004',
  'ctrl-z': '\u001a',
  enter: '\r',
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  escape: '\u001b',
  tab: '\t',
}

/** Enter, as a keyboard sends it: carriage return, never linefeed. */
const ENTER = '\r'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Splits model-authored text into the separate writes a keyboard would produce.
 *
 * Enter has to be its own write. A full-screen program reads stdin in chunks
 * and treats one chunk as one input event, so "message\r" written in a single
 * call is read as text that happens to end in a carriage return: it lands in
 * the composer and is never submitted, because the program's Enter handler
 * only fires for a chunk that *is* Enter. Returning the breaks as their own
 * chunks lets the caller space them out in time, which is what forces the
 * program to see two events instead of one.
 */
export function toInputChunks(text: string): string[] {
  const chunks: string[] = []
  const lines = text.replace(/\r\n|\r/g, '\n').split('\n')
  lines.forEach((line, index) => {
    if (line) chunks.push(line)
    if (index < lines.length - 1) chunks.push(ENTER)
  })
  return chunks
}

/**
 * Sequences that make a terminal answer back, removed from replayed history.
 *
 * A repaint feeds recorded bytes to a live emulator, and xterm cannot tell
 * them from a program talking to it now: it dutifully replies to every query
 * in the recording, and those replies are written to the pty as if the user
 * had typed them. The original asker is long gone, so they land on the shell
 * prompt as junk — `1;2c0;276;0c10;rgb:1f1f/...` sitting in front of the
 * cursor. Answering history is meaningless, so history is stripped of the
 * questions. Live output is untouched: a program waiting on a reply must get
 * one.
 *
 * Covers device attributes (CSI c), device status reports (CSI n), the OSC
 * colour queries, and XTVERSION. `CSI > q` is matched with its `>` so cursor
 * style (`CSI q`) survives.
 */
const TERMINAL_QUERIES = [
  /\u001b\[[?>=]?[0-9;]*c/g,
  /\u001b\[\??[0-9;]*n/g,
  /\u001b\][0-9]+;\?(?:\u0007|\u001b\\)/g,
  /\u001b\[>[0-9;]*q/g,
  /\u001bP\+q[^\u001b]*\u001b\\/g,
]

export function stripTerminalQueries(value: string): string {
  return TERMINAL_QUERIES.reduce((text, pattern) => text.replace(pattern, ''), value)
}

/** Marks the row a menu has selected, for a reader that cannot see colour. */
const SELECTED_ROW_PREFIX = '[selected] '

/**
 * Share of a row's cells that must be painted for it to count as highlighted.
 * High enough that a few coloured words in ordinary output do not qualify —
 * a selected row is painted end to end.
 */
const PAINTED_ROW_RATIO = 0.6

/**
 * The row a menu has selected, or null when nothing looks selected.
 *
 * A TUI marks its current row by painting it — reverse video, or a background
 * colour — and plain text throws all of that away, so an agent reading the
 * screen cannot tell where it is before it starts pressing arrows.
 *
 * Painted rows are not always selections, though: a tmux status bar, a vim
 * status line and an htop header are all painted end to end. Those live at the
 * edges of the screen, so edge rows are set aside when something else is
 * painted too. If that still leaves more than one, the cursor breaks the tie,
 * and failing that nothing is marked — a missing label is recoverable, a label
 * on the wrong row sends the agent somewhere it did not intend to go.
 */
export function findSelectedRow(buffer: IBuffer): number | null {
  const painted: number[] = []
  const cell = buffer.getNullCell()
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)
    if (line && isPaintedRow(line, cell)) painted.push(row)
  }
  if (painted.length === 0) return null
  if (painted.length === 1) return painted[0]

  const top = buffer.baseY
  const bottom = buffer.baseY + buffer.viewportY + buffer.length - 1
  const inner = painted.filter((row) => row !== top && row !== bottom && row !== buffer.length - 1)
  if (inner.length === 1) return inner[0]

  const cursorRow = buffer.baseY + buffer.cursorY
  const candidates = inner.length > 0 ? inner : painted
  return candidates.includes(cursorRow) ? cursorRow : null
}

/** Whether a row is drawn highlighted: reverse video, or a filled background. */
function isPaintedRow(line: IBufferLine, cell: IBufferCell): boolean {
  let painted = 0
  for (let column = 0; column < line.length; column++) {
    line.getCell(column, cell)
    if (cell.isInverse() || !cell.isBgDefault()) painted++
  }
  return line.length > 0 && painted / line.length >= PAINTED_ROW_RATIO
}

/** Strips CSI/OSC sequences so the model reads text rather than escape codes. */
export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[[\]][0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/**
 * Keeps the head and tail of oversized output. A long build log's useful parts
 * are the start and the failure at the end; the middle is filler.
 */
export function elide(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  const half = Math.floor(limit / 2)
  const omitted = value.length - half * 2
  return {
    text: `${value.slice(0, half)}\n\n[... ${omitted} characters omitted ...]\n\n${value.slice(-half)}`,
    truncated: true,
  }
}

/**
 * A program that switches to the alternate screen buffer has taken the whole
 * terminal: an editor, a pager, or a coding agent. Its output is a stream of
 * repaints rather than text, and it will not exit on its own.
 */
const ALT_SCREEN_ENTER = '\u001b[?1049h'
/** Restoring the normal screen: the full-screen program has quit. */
const ALT_SCREEN_EXIT = '\u001b[?1049l'

/**
 * Scrollback the on-demand emulator keeps while rendering a read.
 *
 * Only ever needs to cover what a read returns — a couple of hundred lines by
 * default — so this is generous rather than the 5,000 the old always-on
 * emulator held per terminal, which at ~12 bytes a cell was megabytes of
 * buffer per shell for rows nothing ever asked for.
 */
const EMULATOR_SCROLLBACK_LINES = 1_000

/** How often a running command is checked for having stopped mid-line. */
const PROMPT_POLL_INTERVAL_MS = 500

/**
 * Gap held between the writes of one typed message. Long enough that the
 * program gets a separate stdin read per chunk rather than coalescing them
 * into a single paste-like event, which is the whole point of splitting them.
 */
const KEYSTROKE_GAP_MS = 150

/**
 * Cap on waiting for a program to finish redrawing after each chunk. A TUI
 * with an animating spinner never goes quiet, so the settle wait needs a
 * ceiling or typing would stall on it.
 */
const KEYSTROKE_SETTLE_MAX_MS = 1_000

interface PendingCommand {
  command: string
  toolCallId: string
  startedAt: number
  /** Last time the command produced output; the basis for prompt detection. */
  lastActivityAt: number
  promptWatchdog: NodeJS.Timeout
  /** Capped head of the captured output. */
  output: string
  /** Rolling tail kept once {@link MAX_CAPTURE_CHARS} is exceeded. */
  overflow: string
  capturing: boolean
  timer: NodeJS.Timeout
  resolve(result: TerminalRunResult): void
}

export interface TerminalSessionCallbacks {
  onData(terminalId: string, data: string): void
  onState(): void
  onCommand(event: TerminalCommandEvent): void
  /**
   * The shell ended by itself — the user ran `exit`, or pressed Ctrl-D at an
   * empty prompt. Distinct from the service disposing the session, which is
   * already-known and never reaches here.
   */
  onExit(terminalId: string): void
}

export interface TerminalSessionOptions {
  terminalId: string
  cwd: string
  cols: number
  rows: number
  callbacks: TerminalSessionCallbacks
}

export class TerminalSession {
  private readonly pty: IPty
  /** The environment the shell was spawned with, for tmux to reuse. */
  private readonly shellEnv: NodeJS.ProcessEnv
  private readonly parser: ShellIntegrationParser
  private readonly integrationDir: string
  private readonly callbacks: TerminalSessionCallbacks
  private readonly shellName: string
  readonly terminalId: string

  /**
   * Raw bytes as the shell produced them, ANSI intact.
   *
   * Kept rather than a rendered screen because rendering needs an emulator,
   * and these replay into one on demand — for a panel repainting, or for
   * answering a read. Handing the model this stream directly would not do:
   * a full-screen program redraws constantly, so stripping escape codes from
   * it leaves dozens of overlapping copies of the same screen rather than what
   * is actually on it.
   */
  private scrollback = ''
  private pendingOutput = ''
  /** When the program last painted anything; the basis for the settle wait. */
  private lastOutputAt = 0
  private flushTimer: NodeJS.Timeout | null = null
  private paused = false
  private disposed = false

  private cwd: string
  private columns: number
  private lines: number
  private shellIntegration = false
  private altScreen = false
  private foregroundCommand: string | null = null
  private pendingCommand: PendingCommand | null = null
  /** Command line reported by the shell but not yet bracketed by output-start. */
  private announcedCommand: string | null = null
  private integrationWaiters: Array<() => void> = []

  private constructor(
    options: TerminalSessionOptions,
    pty: IPty,
    integrationDir: string,
    nonce: string,
    shellName: string,
    shellEnv: NodeJS.ProcessEnv
  ) {
    this.callbacks = options.callbacks
    this.terminalId = options.terminalId
    this.cwd = options.cwd
    this.columns = options.cols
    this.lines = options.rows
    this.pty = pty
    this.shellEnv = shellEnv
    this.integrationDir = integrationDir
    this.shellName = shellName
    this.parser = new ShellIntegrationParser(nonce)

    this.pty.onData((chunk) => this.handleData(chunk))
    this.pty.onExit(() => this.handleExit())
  }

  static create(options: TerminalSessionOptions): TerminalSession {
    const shellPath = process.env.SHELL || '/bin/zsh'
    const shell = detectShell(shellPath)
    const nonce = createNonce()
    const integrationDir = mkdtempSync(join(tmpdir(), 'sim-terminal-'))

    // ELECTRON_RUN_AS_NODE is stripped by omission rather than assignment: the
    // child environment is passed through verbatim, so leaving the key present
    // with an undefined value hands the shell the literal string "undefined"
    // and it boots as Node instead of a shell.
    const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env as Record<string, string>

    // A shell we cannot instrument still gives the user a working terminal;
    // the agent is refused separately via NO_SHELL_INTEGRATION.
    const launch = shell
      ? buildShellLaunch(shell, integrationDir, nonce, env)
      : { args: ['-l'], env: {} }

    const shellEnv = { ...env, ...launch.env, TERM: 'xterm-256color', TERM_PROGRAM: 'Sim' }
    const pty = spawn(shellPath, launch.args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: shellEnv,
    })

    logger.info('Started terminal session', { shell: shellPath, instrumented: shell !== null })
    return new TerminalSession(options, pty, integrationDir, nonce, shell ?? shellPath, shellEnv)
  }

  /**
   * The shell's process id. tmux clients launched from this shell descend
   * from it, which is how a terminal is matched to its tmux session.
   */
  get pid(): number {
    return this.pty.pid
  }

  /**
   * Reconciles the tracked cwd with the shell's real one, read from the OS.
   *
   * The shell-integration hooks report `cd` instantly when they are installed,
   * but they cannot be relied on alone: a shell we cannot instrument, a config
   * that overrides the prompt hooks, or a session whose hooks never loaded
   * would otherwise leave the tab labelled with the directory the shell
   * started in — the user's home, whose basename is their username. Asking the
   * OS needs no cooperation from the shell, so it is what makes the label
   * correct in every case.
   */
  async refreshCwd(): Promise<void> {
    if (this.disposed) return
    const cwd = await readProcessCwd(this.pty.pid)
    if (this.disposed || !cwd || cwd === this.cwd) return
    this.cwd = cwd
    this.emitState()
  }

  /**
   * The shell's environment. tmux invocations made on this terminal's behalf
   * reuse it so they reach the same server socket the user's client is on.
   */
  get env(): NodeJS.ProcessEnv {
    return this.shellEnv
  }

  get alive(): boolean {
    return !this.disposed
  }

  get cols(): number {
    return this.columns
  }

  get rows(): number {
    return this.lines
  }

  get currentCwd(): string | null {
    return this.cwd
  }

  get shell(): string | null {
    return this.shellName
  }

  get foreground(): string | null {
    return this.foregroundCommand
  }

  /**
   * Tab-strip view of this terminal. The label prefers the running command,
   * which is what the user is actually waiting on, and falls back to the
   * directory name — the two things that distinguish one terminal from another
   * at a glance.
   */
  tabState(active: boolean): TerminalTabState {
    const directory = this.cwd ? (this.cwd.split('/').filter(Boolean).pop() ?? '/') : null
    return {
      terminalId: this.terminalId,
      // The directory, always: whether to show the running command instead is
      // a presentation choice, and the panel makes it (it holds a label back
      // until a command has run long enough to be worth naming). Reporting the
      // command here would also mean gating `running` to match, and that is
      // data the agent reads — it must stay true the instant a command starts.
      title: directory || 'Terminal',
      cwd: this.cwd,
      // Never an empty string. A shell can start a command without announcing
      // its text, and "" would read as "nothing is running" to everything
      // downstream while the terminal is in fact busy — the agent would treat
      // it as free and the tab would render a blank label.
      running: this.foregroundCommand === null ? null : this.foregroundCommand.trim() || 'command',
      interactive: this.altScreen,
      active,
    }
  }

  get isBusy(): boolean {
    return this.foregroundCommand !== null
  }

  get hasShellIntegration(): boolean {
    return this.shellIntegration
  }

  /**
   * Resolves once the shell has emitted its first integration marker, or when
   * `timeoutMs` elapses. A shell takes a few hundred milliseconds to run its
   * startup files, so a command issued immediately after spawn would otherwise
   * be refused for having no integration when it is merely early.
   */
  waitForShellIntegration(timeoutMs: number): Promise<boolean> {
    if (this.shellIntegration) return Promise.resolve(true)
    if (this.disposed) return Promise.resolve(false)
    return new Promise((resolve) => {
      const notify = () => {
        clearTimeout(timer)
        resolve(this.shellIntegration)
      }
      const timer = setTimeout(() => {
        this.integrationWaiters = this.integrationWaiters.filter((entry) => entry !== notify)
        resolve(this.shellIntegration)
      }, timeoutMs)
      this.integrationWaiters.push(notify)
    })
  }

  write(data: string): void {
    if (this.disposed) return
    this.pty.write(data)
  }

  sendKey(key: TerminalControlKey): void {
    this.write(CONTROL_KEY_BYTES[key])
  }

  /**
   * Presses keys in order, spaced the way typed text is.
   *
   * Same reasoning as {@link type}: a program reads one stdin chunk as one
   * event, so three arrows written together can arrive as a single keystroke.
   * The pause also lets a menu redraw between presses, which is what makes a
   * batch land on the row a person pressing the same keys would reach.
   */
  async pressKeys(keys: TerminalControlKey[]): Promise<void> {
    for (let index = 0; index < keys.length; index += 1) {
      if (this.disposed) return
      if (index > 0) await this.settleBetweenKeystrokes()
      this.sendKey(keys[index])
    }
  }

  /**
   * Types text the way a person would: each line and each Enter as its own
   * write, spaced out so the program reads them as separate keystrokes and
   * gets a chance to redraw between them. See {@link toInputChunks} for why
   * sending it all at once leaves the text unsubmitted.
   */
  async type(text: string): Promise<void> {
    const chunks = toInputChunks(text)
    for (let index = 0; index < chunks.length; index += 1) {
      if (this.disposed) return
      if (index > 0) await this.settleBetweenKeystrokes()
      this.write(chunks[index])
    }
  }

  /** Holds a gap, then lets any resulting redraw finish before the next write. */
  private async settleBetweenKeystrokes(): Promise<void> {
    await delay(KEYSTROKE_GAP_MS)
    const deadline = Date.now() + KEYSTROKE_SETTLE_MAX_MS
    while (!this.disposed) {
      const quietFor = Date.now() - this.lastOutputAt
      const remaining = Math.min(KEYSTROKE_GAP_MS - quietFor, deadline - Date.now())
      if (remaining <= 0) return
      await delay(remaining)
    }
  }

  resize(cols: number, rows: number): void {
    if (this.disposed || cols <= 0 || rows <= 0) return
    this.columns = cols
    this.lines = rows
    try {
      this.pty.resize(cols, rows)
    } catch (error) {
      logger.warn('Failed to resize pty', { error: (error as Error).message })
    }
    this.emitState()
  }

  kill(signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL'): void {
    if (this.disposed) return
    // SIGINT is delivered as a keystroke so the foreground process group gets
    // it the way Ctrl-C would, rather than only the shell.
    if (signal === 'SIGINT') {
      this.write('\u0003')
      return
    }
    try {
      this.pty.kill(signal)
    } catch (error) {
      logger.warn('Failed to signal pty', { signal, error: (error as Error).message })
    }
  }

  /**
   * Writes a command into the shell so it echoes and streams exactly as if the
   * user had typed it, then waits for it to finish.
   *
   * The wait is deliberately short. Anything still going when it elapses comes
   * back as `running` with the output so far, rather than blocking the turn:
   * the agent polls it from there, which keeps the user seeing progress and
   * lets the agent react to what appears.
   */
  runCommand(command: string, toolCallId: string, waitMs: number): Promise<TerminalRunResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.resolveStillRunning(false), waitMs)
      const promptWatchdog = setInterval(() => this.checkForPrompt(), PROMPT_POLL_INTERVAL_MS)
      this.pendingCommand = {
        command,
        toolCallId,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        promptWatchdog,
        output: '',
        overflow: '',
        capturing: false,
        timer,
        resolve,
      }
      this.foregroundCommand = command
      this.emitState()
      this.callbacks.onCommand({ terminalId: this.terminalId, phase: 'start', command, toolCallId })

      // Ctrl-U clears anything half-typed at the prompt so the agent's command
      // is not appended to a partial line. Safe because a command only starts
      // when nothing holds the foreground.
      this.write('\u0015')
      this.write(`${command}\r`)
    })
  }

  /**
   * Raw scrollback for repainting a freshly mounted xterm, with the pending
   * batch consumed rather than flushed: those bytes are already part of the
   * scrollback, so delivering them again after the repaint would duplicate
   * them on screen.
   */
  takeReplaySnapshot(): string {
    this.pendingOutput = ''
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    return stripTerminalQueries(this.scrollback)
  }

  /**
   * Renders the terminal's screen, building an emulator on demand.
   *
   * The bytes are already retained raw, so the screen can be reconstructed by
   * replaying them — the same thing the panel does when a view repaints. The
   * alternative, keeping a live emulator fed with every byte forever, meant a
   * full VT parser per terminal running on the Electron main process for the
   * life of the shell, and xterm parses in self-rescheduling 12ms slices
   * because it was written for a renderer with one terminal to a thread. With
   * several terminals producing output that is most of the event loop that
   * every window's IPC also has to get through, which is why unrelated UI went
   * sluggish. Parsing on demand moves that cost from always to per read.
   */
  async readScrollback(lines: number): Promise<TerminalReadResult> {
    const emulator = new HeadlessTerminal({
      cols: this.columns,
      rows: this.lines,
      scrollback: EMULATOR_SCROLLBACK_LINES,
      allowProposedApi: true,
    })
    try {
      // xterm parses asynchronously in slices, so the buffer is only complete
      // once the write callback fires.
      await new Promise<void>((resolve) => emulator.write(this.scrollback, resolve))
      return this.renderScreen(emulator.buffer.active, lines)
    } finally {
      emulator.dispose()
    }
  }

  private renderScreen(buffer: IBuffer, lines: number): TerminalReadResult {
    const selected = findSelectedRow(buffer)
    // `buffer.active` is the alternate buffer while a full-screen program is
    // up and the normal one otherwise, so this reads correctly either way.
    const rowAt = (row: number) => buffer.getLine(row)?.translateToString(true) ?? ''

    // The buffer is always a full screen tall, so its bottom rows are blank
    // padding below the content. Anchor to the last row with anything on it —
    // counting back from the raw bottom would return nothing but blanks.
    let lastRow = buffer.length - 1
    while (lastRow >= 0 && rowAt(lastRow).trim() === '') lastRow--
    if (lastRow < 0) {
      return {
        output: '',
        cwd: this.cwd,
        terminalId: this.terminalId,
        truncated: false,
        running: this.foregroundCommand,
      }
    }

    const wanted = lines > 0 ? lines : lastRow + 1
    const firstRow = Math.max(0, lastRow - wanted + 1)
    const rendered: string[] = []
    for (let row = firstRow; row <= lastRow; row++) {
      rendered.push(row === selected ? `${SELECTED_ROW_PREFIX}${rowAt(row)}` : rowAt(row))
    }

    const { text, truncated } = elide(rendered.join('\n'), MAX_TOOL_OUTPUT_CHARS)
    return {
      output: text,
      cwd: this.cwd,
      terminalId: this.terminalId,
      truncated: truncated || firstRow > 0,
      running: this.foregroundCommand,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.finishCommand(null)
    try {
      this.pty.kill()
    } catch {
      // Already gone.
    }
    this.cleanupIntegrationDir()
    this.emitState()
  }

  /**
   * Removes the generated startup files. Never throws: the shell writes into
   * this directory as it exits (zsh drops a `.zcompdump` there, since it is
   * also ZDOTDIR), which races the delete and raises ENOTEMPTY. Teardown runs
   * on app quit, so letting that escape would break shutdown over a temp file
   * the OS reclaims anyway. One deferred retry catches the common race.
   */
  private cleanupIntegrationDir(retry = true): void {
    try {
      rmSync(this.integrationDir, { recursive: true, force: true })
    } catch {
      if (!retry) return
      setTimeout(() => this.cleanupIntegrationDir(false), 2_000).unref()
    }
  }

  private handleData(chunk: string): void {
    const { text, markers } = this.parser.parse(chunk)

    for (const marker of markers) {
      this.applyMarker(marker)
    }

    if (text) {
      this.lastOutputAt = Date.now()
      this.trackAltScreen(text)
      this.scrollback += text
      if (this.scrollback.length > MAX_SCROLLBACK_CHARS + TRIM_SLACK_CHARS) {
        this.scrollback = this.scrollback.slice(-MAX_SCROLLBACK_CHARS)
      }
      if (this.pendingCommand?.capturing) {
        this.pendingCommand.lastActivityAt = Date.now()
        this.captureOutput(this.pendingCommand, text)
        if (text.includes(ALT_SCREEN_ENTER)) {
          this.resolveInteractiveCommand()
        }
      }
      this.pendingOutput += text
      this.scheduleFlush()
    }
  }

  private applyMarker(
    marker: ReturnType<ShellIntegrationParser['parse']>['markers'][number]
  ): void {
    switch (marker.kind) {
      case 'prompt-start':
        if (!this.shellIntegration) {
          this.shellIntegration = true
          this.emitState()
          const waiters = this.integrationWaiters
          this.integrationWaiters = []
          for (const notify of waiters) notify()
        }
        break
      case 'command-line':
        this.announcedCommand = marker.command
        break
      case 'output-start': {
        if (this.pendingCommand) {
          this.pendingCommand.capturing = true
          break
        }
        // No agent command in flight, so the user typed this one.
        const command = this.announcedCommand ?? ''
        this.foregroundCommand = command
        this.emitState()
        this.callbacks.onCommand({ terminalId: this.terminalId, phase: 'start', command })
        break
      }
      case 'output-end':
        this.finishCommand(marker.exitCode)
        break
      case 'cwd':
        if (marker.cwd && marker.cwd !== this.cwd) {
          this.cwd = marker.cwd
          this.emitState()
        }
        break
    }
  }

  /**
   * Follows the alternate-screen switches so the tab can tell an open
   * application from a command that is merely slow. Entering is what makes a
   * program full-screen; leaving means it has quit and given the shell back.
   */
  private trackAltScreen(text: string): void {
    const entered = text.lastIndexOf(ALT_SCREEN_ENTER)
    const exited = text.lastIndexOf(ALT_SCREEN_EXIT)
    if (entered === -1 && exited === -1) return
    const next = entered > exited
    if (next === this.altScreen) return
    this.altScreen = next
    this.emitState()
  }

  /**
   * Buffers captured output with a fixed ceiling: the head is kept intact and
   * everything past the cap collapses into a rolling tail, so a program
   * repainting the screen thousands of times cannot exhaust memory.
   */
  private captureOutput(pending: PendingCommand, text: string): void {
    if (pending.output.length < MAX_CAPTURE_CHARS) {
      pending.output += text
      return
    }
    pending.overflow += text
    if (pending.overflow.length > MAX_CAPTURE_CHARS + TRIM_SLACK_CHARS) {
      pending.overflow = pending.overflow.slice(-MAX_CAPTURE_CHARS)
    }
  }

  /**
   * Answers a command that has taken over the screen, without waiting for it to
   * finish — it will not. The foreground stays held because the program really
   * is still running: the user can drive it in the panel, and the agent can
   * stop it with terminal_kill. The captured redraws are discarded rather than
   * returned, since they are frames rather than output.
   */
  private resolveInteractiveCommand(): void {
    this.detachStillRunning((pending) => ({
      command: pending.command,
      output:
        'This opened a full-screen interactive program, which now holds the terminal until it exits. terminal_read renders its current screen, so you can watch it: if it is doing work the user is waiting on, keep polling with wait + terminal_read until it finishes, exactly as you would a long command. Type into it with terminal_input and stop it with terminal_kill. The user can also drive it in the panel. terminal_run reports BUSY until it exits.',
      status: 'interactive',
      exitCode: null,
      durationMs: Date.now() - pending.startedAt,
      cwd: this.cwd,
      terminalId: this.terminalId,
      truncated: false,
    }))
  }

  /**
   * Hands back a command that is still going when the wait window elapses,
   * with whatever it has printed so far. Not a failure: the agent polls from
   * here with wait + terminal_read, which keeps the user seeing progress and
   * lets the agent notice a prompt or an error as it appears.
   */
  /**
   * Hands a command back early when it has stopped mid-line and gone quiet —
   * the shape of something sitting on a prompt. Output that ends with a
   * newline, or that is still arriving, is a command doing work and is left to
   * run out the full wait window.
   */
  private checkForPrompt(): void {
    const pending = this.pendingCommand
    if (!pending?.capturing) return
    if (Date.now() - pending.lastActivityAt < PROMPT_IDLE_MS) return
    const captured = this.capturedText(pending)
    if (!captured.trim() || /[\r\n]$/.test(captured)) return
    this.resolveStillRunning(true)
  }

  private resolveStillRunning(awaitingInput: boolean): void {
    this.detachStillRunning((pending) => {
      const { text, truncated } = elide(
        stripAnsi(this.capturedText(pending)).trim(),
        MAX_TOOL_OUTPUT_CHARS
      )
      return {
        command: pending.command,
        output: text,
        status: 'running',
        exitCode: null,
        durationMs: Date.now() - pending.startedAt,
        cwd: this.cwd,
        terminalId: this.terminalId,
        truncated,
        ...(awaitingInput ? { awaitingInput: true } : {}),
      }
    })
  }

  /**
   * Resolves the pending promise while LEAVING the foreground held. In both
   * non-completion cases the command really is still running, so releasing the
   * slot would let the next terminal_run interleave with it instead of
   * correctly reporting BUSY.
   */
  private detachStillRunning(build: (pending: PendingCommand) => TerminalRunResult): void {
    const pending = this.pendingCommand
    if (!pending) return
    clearTimeout(pending.timer)
    clearInterval(pending.promptWatchdog)
    this.pendingCommand = null
    pending.resolve(build(pending))
  }

  private capturedText(pending: PendingCommand): string {
    return pending.overflow
      ? `${pending.output}\n\n[... output truncated ...]\n\n${pending.overflow}`
      : pending.output
  }

  private finishCommand(exitCode: number | null): void {
    const pending = this.pendingCommand
    const command = this.foregroundCommand

    if (pending) {
      clearTimeout(pending.timer)
      clearInterval(pending.promptWatchdog)
      this.pendingCommand = null
      const { text, truncated } = elide(
        stripAnsi(this.capturedText(pending)).trim(),
        MAX_TOOL_OUTPUT_CHARS
      )
      const durationMs = Date.now() - pending.startedAt
      pending.resolve({
        command: pending.command,
        output: text,
        status: 'completed',
        exitCode,
        durationMs,
        cwd: this.cwd,
        terminalId: this.terminalId,
        truncated,
      })
      this.callbacks.onCommand({
        terminalId: this.terminalId,
        phase: 'end',
        command: pending.command,
        toolCallId: pending.toolCallId,
        ...(exitCode === null ? {} : { exitCode }),
        durationMs,
      })
    } else if (command !== null) {
      this.callbacks.onCommand({
        terminalId: this.terminalId,
        phase: 'end',
        command,
        ...(exitCode === null ? {} : { exitCode }),
      })
    }

    this.foregroundCommand = null
    this.announcedCommand = null
    this.altScreen = false
    this.emitState()
  }

  private scheduleFlush(): void {
    if (this.pendingOutput.length >= PAUSE_HIGH_WATER_CHARS && !this.paused) {
      this.paused = true
      this.pty.pause()
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  private flush(): void {
    if (!this.pendingOutput) return
    const data = this.pendingOutput
    this.pendingOutput = ''
    this.callbacks.onData(this.terminalId, data)
    if (this.paused) {
      this.paused = false
      this.pty.resume()
    }
  }

  private handleExit(): void {
    if (this.disposed) return
    this.disposed = true
    const waiters = this.integrationWaiters
    this.integrationWaiters = []
    for (const notify of waiters) notify()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.flush()
    this.finishCommand(null)
    this.cleanupIntegrationDir()
    this.emitState()
    this.callbacks.onExit(this.terminalId)
  }

  private emitState(): void {
    this.callbacks.onState()
  }
}
