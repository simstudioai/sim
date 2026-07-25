/**
 * The agent-terminal service: several concurrent shells, their tab ordering,
 * and tool execution against them.
 *
 * Commands run unattended. There is no per-command approval and no OS jail, so
 * anything the agent runs holds the user's own privileges — the only controls
 * left are upstream: the desktop capability gate, and the tool-authorization
 * check in ipc.ts that ties every call to a real pending Copilot tool call so
 * page code cannot invent one. Reintroducing a boundary means adding it back
 * here, in main, where the renderer cannot route around it.
 */
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { createLogger } from '@sim/logger'
import {
  DEFAULT_RUN_WAIT_MS,
  isTerminalControlKey,
  MAX_RUN_WAIT_MS,
  MAX_TERMINALS,
  MAX_TOOL_OUTPUT_CHARS,
  type TerminalCommandEvent,
  type TerminalCwdResult,
  type TerminalErrorCode,
  type TerminalOperation,
  type TerminalPanesResult,
  type TerminalStartOptions,
  type TerminalTabsState,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import { elide, TerminalSession } from '@/main/terminal/session'
import {
  activePane,
  awaitRun,
  capturePane,
  closeRunWindow,
  listPanes,
  resolveAttachment,
  sendKey,
  sendText,
  startRun,
  TMUX_KEY_NAMES,
} from '@/main/terminal/tmux'

const logger = createLogger('DesktopTerminal')

/**
 * How long to let a just-spawned shell finish its startup files before
 * concluding it has no integration. Generous because a heavy `.zshrc`
 * (nvm, pyenv, starship) can take a while on a cold start.
 */
const SHELL_INTEGRATION_TIMEOUT_MS = 8_000

/** Grace for a program to react to input before its screen is worth reading. */
const INPUT_ECHO_MS = 250

/** Enough of the screen to show whether the input took, without a wall of it. */
const INPUT_SCREEN_LINES = 60

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long to hold the turn before handing a still-running command back. */
function resolveWaitMs(waitSeconds: number | undefined): number {
  const requested = Number(waitSeconds)
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested * 1000, MAX_RUN_WAIT_MS)
    : DEFAULT_RUN_WAIT_MS
}

function elideOutput(value: string): { text: string; truncated: boolean } {
  return elide(value, MAX_TOOL_OUTPUT_CHARS)
}

const EMPTY_TABS: TerminalTabsState = { tabs: [], activeTerminalId: null }

class TerminalError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TerminalError'
  }
}

/** Where the service pushes live updates; wired to the renderer by ipc.ts. */
export interface TerminalSink {
  data(terminalId: string, data: string): void
  tabs(state: TerminalTabsState): void
  command(event: TerminalCommandEvent): void
}

export interface TerminalServiceOptions {
  /**
   * Where the last session left off, so reopening the terminal resumes in the
   * directory the user was working in rather than dropping them back in
   * `$HOME`. Returning undefined (or a path that no longer exists) falls back
   * to the home directory.
   */
  loadCwd?(): string | undefined
  saveCwd?(cwd: string): void
}

export class TerminalService {
  /** Insertion-ordered, which is also the tab order the user sees. */
  private readonly sessions = new Map<string, TerminalSession>()
  private activeId: string | null = null
  private nextId = 1
  private sink: TerminalSink | null = null
  private lastEmittedTabs: string | null = null

  constructor(private readonly options: TerminalServiceOptions = {}) {}

  setSink(sink: TerminalSink | null): void {
    this.sink = sink
    // A new sink has seen nothing, so the dedupe baseline has to reset or the
    // panel would wait for an unrelated change before learning the tab list.
    this.lastEmittedTabs = null
  }

  getTabs(): TerminalTabsState {
    if (this.sessions.size === 0) return EMPTY_TABS
    return {
      tabs: [...this.sessions.values()].map((session) =>
        session.tabState(session.terminalId === this.activeId)
      ),
      activeTerminalId: this.activeId,
    }
  }

  /** Opens the first terminal, or adopts what is already running. */
  start(options: TerminalStartOptions): TerminalTabsState {
    if (this.sessions.size === 0) {
      this.spawn(this.startingCwd(), options.cols, options.rows)
    }
    return this.getTabs()
  }

  /**
   * Everything on a terminal's screen, for a freshly created view to paint
   * itself from.
   *
   * Pulled by the view rather than pushed on start. Pushing meant the repaint
   * was aimed at whoever happened to be subscribed at the time: on a first
   * mount that is nobody, because the tab list is still empty and no view
   * exists yet, so the paint was dropped and the panel came up blank over a
   * shell that had been running all along. On later mounts it was everybody,
   * so a panel that already had its content repainted anyway. A view asking
   * for its own terminal is right in both cases, and asks exactly once.
   */
  getScrollback(terminalId: string): string {
    return this.sessions.get(terminalId)?.takeReplaySnapshot() ?? ''
  }

  /** Opens an additional terminal and makes it active. */
  openTerminal(cwd?: string): TerminalTabsState {
    if (this.sessions.size >= MAX_TERMINALS) {
      throw new TerminalError(
        'TOO_MANY_TERMINALS',
        `Up to ${MAX_TERMINALS} terminals can be open at once. Close one first.`
      )
    }
    const active = this.activeId ? this.sessions.get(this.activeId) : null
    const size = active ? { cols: active.cols, rows: active.rows } : { cols: 80, rows: 24 }
    // A new terminal opens where the current one is: the user is almost always
    // continuing the same piece of work in a second shell.
    this.spawn(cwd ?? active?.currentCwd ?? this.startingCwd(), size.cols, size.rows)
    return this.getTabs()
  }

  switchTerminal(terminalId: string): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    this.activeId = terminalId
    this.emitTabs()
    return this.getTabs()
  }

  closeTerminal(terminalId: string): TerminalTabsState {
    const session = this.sessions.get(terminalId)
    if (!session) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    const order = [...this.sessions.keys()]
    const index = order.indexOf(terminalId)
    session.dispose()
    this.sessions.delete(terminalId)
    if (this.activeId === terminalId) {
      this.activeId = order[index + 1] ?? order[index - 1] ?? null
    }
    this.emitTabs()
    return this.getTabs()
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sessions.get(terminalId)?.resize(cols, rows)
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.activeId = null
  }

  async executeTool(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<TerminalToolResponse> {
    try {
      const result = await this.dispatch(toolCallId, operation, args ?? {})
      return { ok: true, result }
    } catch (error) {
      if (error instanceof TerminalError) {
        logger.warn('Terminal operation refused', { toolCallId, operation, code: error.code })
        return { ok: false, error: error.message, code: error.code }
      }
      const message = (error as Error).message
      logger.error('Terminal operation failed', { toolCallId, operation, error: message })
      return { ok: false, error: message }
    }
  }

  private async dispatch(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<unknown> {
    switch (operation) {
      case 'list':
        return this.getTabs()
      case 'new':
        return this.openTerminal(typeof args.cwd === 'string' ? args.cwd : undefined)
      case 'switch':
        return this.switchTerminal(this.requireId(args))
      case 'close':
        return this.closeTerminal(this.requireId(args))
      default:
        break
    }

    const session = this.requireSession(args)
    // Resolved once per call: a tab either has tmux attached or it does not,
    // and every operation below behaves differently depending on which.
    const tmux = await resolveAttachment(session.pid, session.env)

    switch (operation) {
      case 'cwd':
        return {
          cwd: session.currentCwd,
          shellName: session.shell,
          home: homedir(),
          terminalId: session.terminalId,
        } satisfies TerminalCwdResult
      case 'panes': {
        if (!tmux) {
          throw new TerminalError(
            'NO_TMUX',
            'That terminal is a plain shell, not a tmux session, so it has no panes.'
          )
        }
        return {
          terminalId: session.terminalId,
          session: tmux.session,
          panes: await listPanes(tmux.session, session.env),
        } satisfies TerminalPanesResult
      }
      case 'run':
        return tmux
          ? this.runInTmux(session, tmux.session, args)
          : this.run(toolCallId, session, args)
      case 'read': {
        const requested = Number(args.lines)
        const lines = Number.isFinite(requested) && requested > 0 ? requested : 200
        if (!tmux) return session.readScrollback(lines)
        const target = await this.resolvePane(tmux.session, args, session)
        const captured = await capturePane(target, lines, session.env)
        if (!captured.ok) {
          throw new TerminalError(
            'NO_SUCH_PANE',
            captured.stderr.trim() || `tmux could not read pane ${target}.`
          )
        }
        return {
          output: captured.stdout,
          cwd: session.currentCwd,
          terminalId: session.terminalId,
          pane: target,
          truncated: false,
          running: null,
        }
      }
      case 'input':
        return tmux
          ? this.inputToTmux(session, tmux.session, args)
          : this.inputToShell(session, args)
      case 'kill': {
        const signal =
          args.signal === 'SIGTERM' || args.signal === 'SIGKILL' || args.signal === 'SIGINT'
            ? args.signal
            : 'SIGINT'
        // Inside tmux a signal has to arrive as a keypress in the pane. Killing
        // the pty would take down the tmux client instead, detaching the user's
        // whole session rather than stopping the one thing they asked about.
        if (tmux) {
          const target = await this.resolvePane(tmux.session, args, session)
          await sendKey(target, signal === 'SIGKILL' ? 'C-\\' : 'C-c', session.env)
          return { signal, terminalId: session.terminalId, pane: target }
        }
        session.kill(signal)
        return { signal, terminalId: session.terminalId }
      }
      default:
        throw new TerminalError('INVALID_REQUEST', `Unknown terminal operation: ${operation}`)
    }
  }

  /** The pane a call names, or the session's active one. */
  private async resolvePane(
    session: string,
    args: TerminalToolArgs,
    terminal: TerminalSession
  ): Promise<string> {
    if (typeof args.pane === 'string' && args.pane.trim()) return args.pane.trim()
    const active = await activePane(session, terminal.env)
    if (!active) {
      throw new TerminalError('NO_SUCH_PANE', `tmux session "${session}" has no active pane.`)
    }
    return active
  }

  /**
   * Types into a tmux pane rather than the pty.
   *
   * Writing to the pty would reach whichever pane tmux happens to have focused
   * and would be invisible to any targeting the caller asked for; send-keys
   * addresses a pane directly. Unlike the plain-shell path this is allowed at
   * an idle prompt, because in tmux there is no foreground command to gate on
   * and typing a command into a pane is the normal way to drive one.
   */
  private async inputToTmux(
    terminal: TerminalSession,
    session: string,
    args: TerminalToolArgs
  ): Promise<unknown> {
    const target = await this.resolvePane(session, args, terminal)
    if (typeof args.key === 'string' && isTerminalControlKey(args.key)) {
      await sendKey(target, TMUX_KEY_NAMES[args.key] ?? args.key, terminal.env)
    } else if (typeof args.text === 'string') {
      await sendText(target, args.text, terminal.env)
      // Enter is a separate send-keys for the same reason it is a separate pty
      // write: a program reading one chunk treats text plus a carriage return
      // as text, and the message sits unsubmitted.
      if (/[\r\n]$/.test(args.text)) await sendKey(target, 'Enter', terminal.env)
    } else {
      throw new TerminalError('INVALID_REQUEST', 'input needs either `text` or `key`.')
    }

    await delay(INPUT_ECHO_MS)
    const captured = await capturePane(target, INPUT_SCREEN_LINES, terminal.env)
    return {
      sent: args.key ?? args.text,
      terminalId: terminal.terminalId,
      pane: target,
      output: captured.stdout,
    }
  }

  private async inputToShell(session: TerminalSession, args: TerminalToolArgs): Promise<unknown> {
    // Input is only ever delivered to a program that already holds the
    // foreground. At a bare shell prompt these bytes would be a command
    // line, and running commands that way would bypass the capture and
    // status tracking that `run` provides.
    if (!session.isBusy) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'Nothing is running in that terminal, so there is nothing to type into. Use the run operation to run a command.'
      )
    }
    // Every input returns the screen it produced. Reporting only "sent"
    // lets the model assume its message went through and start waiting on
    // a reply to text still sitting unsubmitted in a composer; the screen
    // is the evidence of what the program actually did with the input.
    if (isTerminalControlKey(args.key)) {
      session.sendKey(args.key)
      await delay(INPUT_ECHO_MS)
      return { sent: args.key, ...session.readScrollback(INPUT_SCREEN_LINES) }
    }
    if (typeof args.text === 'string') {
      await session.type(args.text)
      await delay(INPUT_ECHO_MS)
      return { sent: args.text, ...session.readScrollback(INPUT_SCREEN_LINES) }
    }
    throw new TerminalError('INVALID_REQUEST', 'input needs either `text` or `key`.')
  }

  /**
   * Runs a command inside a tmux session, in its own window.
   *
   * The user's panes are theirs; borrowing one would type over whatever they
   * are doing. A dedicated window is still visible to them — they can switch
   * to it and watch — while output and the exit status come back through
   * files, so the result is structured even though shell integration cannot
   * see through tmux.
   */
  private async runInTmux(
    terminal: TerminalSession,
    session: string,
    args: TerminalToolArgs
  ): Promise<unknown> {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) throw new TerminalError('INVALID_REQUEST', 'run needs a `command`.')

    const started = Date.now()
    const handle = await startRun(session, command, terminal.currentCwd, terminal.env)
    if ('error' in handle) throw new TerminalError('SPAWN_FAILED', handle.error)

    const waitMs = resolveWaitMs(args.waitSeconds)
    const outcome = await awaitRun(handle, waitMs)
    if (outcome.done) {
      await closeRunWindow(handle, terminal.env)
      handle.dispose()
    }

    const { text, truncated } = elideOutput(outcome.output)
    return {
      command,
      output: text,
      status: outcome.done ? 'completed' : 'running',
      exitCode: outcome.exitCode,
      durationMs: Date.now() - started,
      cwd: terminal.currentCwd,
      terminalId: terminal.terminalId,
      pane: handle.window,
      truncated,
    }
  }

  private async run(
    toolCallId: string,
    session: TerminalSession,
    args: TerminalToolArgs
  ): Promise<unknown> {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) {
      throw new TerminalError('INVALID_REQUEST', 'run needs a `command`.')
    }
    if (!session.hasShellIntegration) {
      await session.waitForShellIntegration(SHELL_INTEGRATION_TIMEOUT_MS)
    }
    if (!session.hasShellIntegration) {
      throw new TerminalError(
        'NO_SHELL_INTEGRATION',
        'This shell did not load Sim shell integration, so command boundaries and exit codes cannot be determined. Ask the user to run the command themselves, or use a bash/zsh session.'
      )
    }
    if (session.isBusy) {
      throw new TerminalError(
        'BUSY',
        `"${session.foreground}" is still running in that terminal. Poll it with the read operation, stop it with kill, or open another terminal with new.`
      )
    }

    return session.runCommand(command, toolCallId, resolveWaitMs(args.waitSeconds))
  }

  private spawn(cwd: string, cols: number, rows: number): TerminalSession {
    const terminalId = String(this.nextId++)
    try {
      const session = TerminalSession.create({
        terminalId,
        cwd,
        cols,
        rows,
        callbacks: {
          onData: (id, data) => this.sink?.data(id, data),
          onState: () => {
            const active = this.activeId ? this.sessions.get(this.activeId) : null
            if (active?.currentCwd) this.options.saveCwd?.(active.currentCwd)
            this.emitTabs()
          },
          onCommand: (event) => this.sink?.command(event),
        },
      })
      this.sessions.set(terminalId, session)
      this.activeId = terminalId
      this.emitTabs()
      return session
    } catch (error) {
      throw new TerminalError('SPAWN_FAILED', (error as Error).message)
    }
  }

  /**
   * Resolves the terminal a tool call targets: the one it named, else the
   * active one. Starting a shell on demand keeps a tool call from depending on
   * the panel having finished mounting — the renderer opens the resource and
   * dispatches the tool in the same tick, so the panel's own `start` usually
   * lands after the tool arrives.
   */
  private requireSession(args: TerminalToolArgs): TerminalSession {
    const requested = typeof args.terminalId === 'string' ? args.terminalId : null
    if (requested) {
      const session = this.sessions.get(requested)
      if (!session?.alive) {
        throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(requested))
      }
      return session
    }

    const active = this.activeId ? this.sessions.get(this.activeId) : null
    if (active?.alive) return active

    const spawned = this.spawn(this.startingCwd(), 80, 24)
    if (!spawned.alive) {
      throw new TerminalError('SPAWN_FAILED', 'Could not open a terminal on this machine.')
    }
    return spawned
  }

  private requireId(args: TerminalToolArgs): string {
    const terminalId = typeof args.terminalId === 'string' ? args.terminalId.trim() : ''
    if (!terminalId) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'This operation needs a `terminalId` from the list operation.'
      )
    }
    return terminalId
  }

  /**
   * The remembered directory when it still exists, else home. A saved path can
   * disappear between launches (a branch checkout, a deleted clone), and
   * spawning into a missing cwd fails outright rather than degrading.
   */
  private startingCwd(): string {
    const remembered = this.options.loadCwd?.()
    if (remembered) {
      try {
        if (statSync(remembered).isDirectory()) return remembered
      } catch {
        // Gone since last launch; fall through to home.
      }
    }
    return homedir()
  }

  /**
   * Broadcasts the tab list only when it has actually changed.
   *
   * Session state is emitted on every shell-integration marker, and a shell
   * repaints its prompt on each resize — so a divider drag would otherwise
   * push a stream of identical tab lists at the renderer and re-render the
   * panel for nothing.
   */
  private emitTabs(): void {
    const tabs = this.getTabs()
    const serialized = JSON.stringify(tabs)
    if (serialized === this.lastEmittedTabs) return
    this.lastEmittedTabs = serialized
    this.sink?.tabs(tabs)
  }
}

function unknownTerminal(terminalId: string): string {
  return `No terminal with id ${terminalId}. Call terminal_list for the open ones.`
}

/** Narrows an IPC payload to the tool-call shape without trusting the sender. */
export function parseToolParams(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}
