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
  MAX_INPUT_KEYS,
  MAX_RUN_WAIT_MS,
  MAX_TERMINALS,
  MAX_TOOL_OUTPUT_CHARS,
  type TerminalCommandEvent,
  type TerminalControlKey,
  type TerminalCwdResult,
  type TerminalErrorCode,
  type TerminalHandoffResult,
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

/**
 * How often the active terminal's directory is reconciled against the OS.
 * Fast enough that a `cd` renames the tab about as soon as the user looks at
 * it, slow enough that the lookup is nowhere near a hot path.
 */
const CWD_POLL_MS = 1_000

/** Pause between keys sent to a tmux pane, matching the pty keystroke gap. */
const TMUX_KEY_GAP_MS = 150

/** How often a handoff checks whether the user or the command has finished. */
const HANDOFF_POLL_MS = 500

/**
 * Ceiling on a handoff. A person can take as long as they like — they may
 * have walked away mid-install — so this only exists so a forgotten handoff
 * cannot hold a turn open forever.
 */
const HANDOFF_MAX_MS = 12 * 60 * 60 * 1000

/**
 * Grace given to a command that is still running after the user hands back.
 * Answering a prompt usually finishes the job within seconds; anything longer
 * is an ordinary long-running command, and comes back as `running` for the
 * agent to poll rather than holding the turn.
 */
const HANDOFF_SETTLE_MS = 5_000

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

/**
 * The keys an input call wants pressed, in order. A lone `key` is the same
 * thing with one element, so both arrive here as one list.
 */
function requestedKeys(args: TerminalToolArgs): TerminalControlKey[] {
  const batch = Array.isArray(args.keys) ? args.keys : []
  const keys = batch.length > 0 ? batch : isTerminalControlKey(args.key) ? [args.key] : []
  return keys.filter(isTerminalControlKey).slice(0, MAX_INPUT_KEYS)
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
  private cwdTimer: NodeJS.Timeout | null = null
  /** True while the user's keyboard focus is in the terminal panel. */
  private panelFocused = false
  /** Directories of recently closed terminals, newest first, for reopening. */
  private readonly recentlyClosedCwds: string[] = []
  /** Terminals handed to the user; the value is whether they have handed back. */
  private readonly handoffs = new Map<string, boolean>()

  constructor(private readonly options: TerminalServiceOptions = {}) {}

  setSink(sink: TerminalSink | null): void {
    this.sink = sink
    // A new sink has seen nothing, so the dedupe baseline has to reset or the
    // panel would wait for an unrelated change before learning the tab list.
    this.lastEmittedTabs = null
    if (sink) this.startCwdWatch()
    else this.stopCwdWatch()
  }

  /**
   * Keeps the visible tab's directory honest without depending on the shell.
   *
   * Only the active session is polled, and only while a panel is attached and
   * nothing is running in the foreground (a running command owns the label
   * anyway), so this costs one cheap lookup a second at most — the reason it
   * samples rather than watching every keystroke.
   */
  private startCwdWatch(): void {
    if (this.cwdTimer) return
    this.cwdTimer = setInterval(() => {
      const active = this.activeId ? this.sessions.get(this.activeId) : null
      if (!active || active.isBusy) return
      void active.refreshCwd()
    }, CWD_POLL_MS)
    this.cwdTimer.unref?.()
  }

  private stopCwdWatch(): void {
    if (!this.cwdTimer) return
    clearInterval(this.cwdTimer)
    this.cwdTimer = null
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
    void this.sessions.get(terminalId)?.refreshCwd()
    return this.getTabs()
  }

  /**
   * Closes a terminal, or resets it when it is the only one left.
   *
   * Emptying the panel is not an option the close button should have: the
   * resource IS a terminal, so a panel with no shell in it is a dead end the
   * user has to close and reopen to escape. Replacing the last shell with a
   * fresh one in the same directory gives the button a sensible meaning at
   * every count — the same shape as closing a browser's last tab, which
   * leaves you a tab rather than an empty window.
   *
   * A shell that exits on its own is different and still closes the panel:
   * that is the user saying they are done, not asking for a clean one.
   */
  closeTerminal(terminalId: string): TerminalTabsState {
    const session = this.sessions.get(terminalId)
    if (!session) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    const closedCwd = session.currentCwd
    const cols = session.cols
    const rows = session.rows
    const order = [...this.sessions.keys()]
    const index = order.indexOf(terminalId)
    session.dispose()
    this.sessions.delete(terminalId)

    if (this.sessions.size === 0) {
      this.spawn(this.resolveCwd(closedCwd), cols, rows)
      return this.getTabs()
    }

    this.rememberClosed(closedCwd)
    if (this.activeId === terminalId) {
      this.activeId = order[index + 1] ?? order[index - 1] ?? null
    }
    this.emitTabs()
    return this.getTabs()
  }

  /**
   * Reopens the most recently closed terminal, in the directory it was in.
   *
   * A shell cannot be restored the way a browser tab can — its processes are
   * gone and its scrollback with them — so this reopens where it was working,
   * which is the part that is expensive for the user to retype.
   */
  reopenClosedTerminal(): boolean {
    if (!this.panelFocused) return false
    const cwd = this.recentlyClosedCwds.shift()
    if (cwd === undefined || this.sessions.size >= MAX_TERMINALS) return false
    this.openTerminal(cwd ?? undefined)
    return true
  }

  /** Closes the active terminal, but only while the panel owns interaction focus. */
  closeFocusedTerminal(): boolean {
    if (!this.panelFocused || !this.activeId) return false
    this.closeTerminal(this.activeId)
    return true
  }

  /**
   * Whether the terminal panel owns keyboard focus. Menu accelerators are
   * global, so Cmd-W has to know whether the user is looking at a terminal or
   * at something else in the window before deciding what to close.
   */
  setPanelFocused(focused: boolean): void {
    this.panelFocused = focused
  }

  private rememberClosed(cwd: string | null): void {
    this.recentlyClosedCwds.unshift(cwd ?? '')
    if (this.recentlyClosedCwds.length > MAX_TERMINALS) {
      this.recentlyClosedCwds.length = MAX_TERMINALS
    }
  }

  /** A directory that still exists, else the usual starting point. */
  private resolveCwd(candidate: string | null): string {
    if (candidate) {
      try {
        if (statSync(candidate).isDirectory()) return candidate
      } catch {
        // Deleted while the shell was open; fall through.
      }
    }
    return this.startingCwd()
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sessions.get(terminalId)?.resize(cols, rows)
  }

  dispose(): void {
    this.stopCwdWatch()
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
      case 'handoff':
        return this.handoff(session, args)
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

  /**
   * Gives the terminal to the user and waits for them.
   *
   * A command sitting on a prompt it cannot answer — a password, a decision
   * that is not the agent's to make — otherwise leaves the tool call spinning
   * with nothing on screen to explain why. This surfaces a chip in the chat
   * saying what is needed, and resolves when the command that was blocking
   * finishes, so the agent resumes knowing the outcome rather than guessing
   * whether the user got to it.
   */
  private async handoff(session: TerminalSession, args: TerminalToolArgs): Promise<unknown> {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
    const terminalId = session.terminalId
    this.handoffs.set(terminalId, false)

    const settled = (handedBack: boolean): TerminalHandoffResult => {
      const view = session.readScrollback(INPUT_SCREEN_LINES)
      return {
        terminalId,
        reason,
        handedBack,
        running: session.foreground,
        output: view.output,
        cwd: session.currentCwd,
      }
    }

    try {
      const deadline = Date.now() + HANDOFF_MAX_MS
      let handedBackAt: number | null = null
      while (Date.now() < deadline) {
        await delay(HANDOFF_POLL_MS)
        if (!session.alive) {
          throw new TerminalError('SESSION_CLOSED', 'That terminal was closed during the handoff.')
        }
        // The command finishing is the real end of the handoff, whether or not
        // the user pressed anything: it means the prompt got answered.
        if (!session.isBusy) return settled(this.handoffs.get(terminalId) === true)
        if (this.handoffs.get(terminalId) === true) {
          handedBackAt ??= Date.now()
          if (Date.now() - handedBackAt >= HANDOFF_SETTLE_MS) return settled(true)
        }
      }
      return settled(this.handoffs.get(terminalId) === true)
    } finally {
      this.handoffs.delete(terminalId)
    }
  }

  /** The user pressing the hand-back button on a waiting handoff. */
  finishHandoff(terminalId: string): void {
    if (this.handoffs.has(terminalId)) this.handoffs.set(terminalId, true)
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
    const keys = requestedKeys(args)
    if (keys.length > 0) {
      for (let index = 0; index < keys.length; index += 1) {
        // Paced like the pty path: a pane redraws between presses, so a batch
        // lands where the same keys pressed by hand would.
        if (index > 0) await delay(TMUX_KEY_GAP_MS)
        await sendKey(target, TMUX_KEY_NAMES[keys[index]] ?? keys[index], terminal.env)
      }
    } else if (typeof args.text === 'string') {
      await sendText(target, args.text, terminal.env)
      // Enter is a separate send-keys for the same reason it is a separate pty
      // write: a program reading one chunk treats text plus a carriage return
      // as text, and the message sits unsubmitted.
      if (/[\r\n]$/.test(args.text)) await sendKey(target, 'Enter', terminal.env)
    } else {
      throw new TerminalError('INVALID_REQUEST', 'input needs `text`, `key`, or `keys`.')
    }

    await delay(INPUT_ECHO_MS)
    const captured = await capturePane(target, INPUT_SCREEN_LINES, terminal.env)
    return {
      sent: keys.length > 0 ? keys.join(', ') : args.text,
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
    const keys = requestedKeys(args)
    if (keys.length > 0) {
      await session.pressKeys(keys)
      await delay(INPUT_ECHO_MS)
      return { sent: keys.join(', '), ...session.readScrollback(INPUT_SCREEN_LINES) }
    }
    if (typeof args.text === 'string') {
      await session.type(args.text)
      await delay(INPUT_ECHO_MS)
      return { sent: args.text, ...session.readScrollback(INPUT_SCREEN_LINES) }
    }
    throw new TerminalError('INVALID_REQUEST', 'input needs `text`, `key`, or `keys`.')
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
