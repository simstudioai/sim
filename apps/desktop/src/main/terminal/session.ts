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
  type TerminalSessionState,
} from '@sim/terminal-protocol'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
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

/**
 * Converts model-authored text into what a keyboard would actually send.
 *
 * Enter is carriage return on a terminal, never linefeed. Models write "\n",
 * and a full-screen program reading raw input treats LF as "insert a line"
 * while CR submits — so text sent with "\n" lands in the input box and just
 * sits there. CRLF collapses to a single CR so one Enter is not sent twice.
 */
export function toKeystrokes(text: string): string {
  return text.replace(/\r\n|\n/g, '\r')
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
function elide(value: string, limit: number): { text: string; truncated: boolean } {
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

/** How often a running command is checked for having stopped mid-line. */
const PROMPT_POLL_INTERVAL_MS = 500

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
  onData(data: string): void
  onState(state: TerminalSessionState): void
  onCommand(event: TerminalCommandEvent): void
}

export interface TerminalSessionOptions {
  cwd: string
  cols: number
  rows: number
  callbacks: TerminalSessionCallbacks
}

export class TerminalSession {
  private readonly pty: IPty
  private readonly parser: ShellIntegrationParser
  private readonly integrationDir: string
  private readonly callbacks: TerminalSessionCallbacks
  private readonly shellName: string

  private scrollback = ''
  /**
   * A headless emulator fed the same bytes as the panel, used to answer
   * terminal_read.
   *
   * Reading the raw byte stream instead would hand the model every frame a
   * program ever painted, concatenated — a full-screen program redraws
   * constantly, so stripping escape codes leaves dozens of overlapping copies
   * of the same screen. Rendering the bytes and reading the resulting buffer
   * gives what is actually on screen: real scrollback for ordinary commands,
   * the current view for a TUI.
   */
  private readonly emulator: HeadlessTerminal
  private pendingOutput = ''
  private flushTimer: NodeJS.Timeout | null = null
  private paused = false
  private disposed = false

  private cwd: string
  private cols: number
  private rows: number
  private shellIntegration = false
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
    shellName: string
  ) {
    this.callbacks = options.callbacks
    this.cwd = options.cwd
    this.cols = options.cols
    this.rows = options.rows
    this.pty = pty
    this.emulator = new HeadlessTerminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: 5_000,
      allowProposedApi: true,
    })
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

    const pty = spawn(shellPath, launch.args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...env, ...launch.env, TERM: 'xterm-256color', TERM_PROGRAM: 'Sim' },
    })

    logger.info('Started terminal session', { shell: shellPath, instrumented: shell !== null })
    return new TerminalSession(options, pty, integrationDir, nonce, shell ?? shellPath)
  }

  get state(): TerminalSessionState {
    return {
      alive: !this.disposed,
      cwd: this.cwd,
      shellName: this.shellName,
      shellIntegration: this.shellIntegration,
      foregroundCommand: this.foregroundCommand,
      cols: this.cols,
      rows: this.rows,
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

  resize(cols: number, rows: number): void {
    if (this.disposed || cols <= 0 || rows <= 0) return
    this.cols = cols
    this.rows = rows
    try {
      this.emulator.resize(cols, rows)
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
      this.callbacks.onCommand({ phase: 'start', command, toolCallId })

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
    return this.scrollback
  }

  readScrollback(lines: number): TerminalReadResult {
    const buffer = this.emulator.buffer.active
    // `buffer.active` is the alternate buffer while a full-screen program is
    // up and the normal one otherwise, so this reads correctly either way.
    const rowAt = (row: number) => buffer.getLine(row)?.translateToString(true) ?? ''

    // The buffer is always a full screen tall, so its bottom rows are blank
    // padding below the content. Anchor to the last row with anything on it —
    // counting back from the raw bottom would return nothing but blanks.
    let lastRow = buffer.length - 1
    while (lastRow >= 0 && rowAt(lastRow).trim() === '') lastRow--
    if (lastRow < 0) {
      return { output: '', cwd: this.cwd, truncated: false, running: this.foregroundCommand }
    }

    const wanted = lines > 0 ? lines : lastRow + 1
    const firstRow = Math.max(0, lastRow - wanted + 1)
    const rendered: string[] = []
    for (let row = firstRow; row <= lastRow; row++) {
      rendered.push(rowAt(row))
    }

    const { text, truncated } = elide(rendered.join('\n'), MAX_TOOL_OUTPUT_CHARS)
    return {
      output: text,
      cwd: this.cwd,
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
    this.emulator.dispose()
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
      this.emulator.write(text)
      this.scrollback += text
      if (this.scrollback.length > MAX_SCROLLBACK_CHARS) {
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
        this.callbacks.onCommand({ phase: 'start', command })
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
   * Buffers captured output with a fixed ceiling: the head is kept intact and
   * everything past the cap collapses into a rolling tail, so a program
   * repainting the screen thousands of times cannot exhaust memory.
   */
  private captureOutput(pending: PendingCommand, text: string): void {
    if (pending.output.length < MAX_CAPTURE_CHARS) {
      pending.output += text
      return
    }
    pending.overflow = (pending.overflow + text).slice(-MAX_CAPTURE_CHARS)
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
        truncated,
      })
      this.callbacks.onCommand({
        phase: 'end',
        command: pending.command,
        toolCallId: pending.toolCallId,
        ...(exitCode === null ? {} : { exitCode }),
        durationMs,
      })
    } else if (command !== null) {
      this.callbacks.onCommand({
        phase: 'end',
        command,
        ...(exitCode === null ? {} : { exitCode }),
      })
    }

    this.foregroundCommand = null
    this.announcedCommand = null
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
    this.callbacks.onData(data)
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
  }

  private emitState(): void {
    this.callbacks.onState(this.state)
  }
}
