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
  type TerminalCommandEvent,
  type TerminalCwdResult,
  type TerminalErrorCode,
  type TerminalStartOptions,
  type TerminalTabsState,
  type TerminalToolName,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import { TerminalSession } from '@/main/terminal/session'

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
  /**
   * Full scrollback for a freshly mounted panel to repaint from. The renderer
   * resets before writing it, so anything it painted beforehand is discarded
   * and cannot duplicate.
   */
  replay(terminalId: string, data: string): void
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
      return this.getTabs()
    }
    // Adopting: the panel is mounting over shells that have been running
    // without it, so hand back everything already on their screens.
    for (const session of this.sessions.values()) {
      this.sink?.replay(session.terminalId, session.takeReplaySnapshot())
    }
    return this.getTabs()
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
    tool: TerminalToolName,
    params: Record<string, unknown>
  ): Promise<TerminalToolResponse> {
    try {
      const result = await this.dispatch(toolCallId, tool, params)
      return { ok: true, result }
    } catch (error) {
      if (error instanceof TerminalError) {
        logger.warn('Terminal tool refused', { toolCallId, tool, code: error.code })
        return { ok: false, error: error.message, code: error.code }
      }
      const message = (error as Error).message
      logger.error('Terminal tool failed', { toolCallId, tool, error: message })
      return { ok: false, error: message }
    }
  }

  private async dispatch(
    toolCallId: string,
    tool: TerminalToolName,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (tool) {
      case 'terminal_list':
        return this.getTabs()
      case 'terminal_new':
        return this.openTerminal(typeof params.cwd === 'string' ? params.cwd : undefined)
      case 'terminal_switch':
        return this.switchTerminal(this.requireId(params))
      case 'terminal_close':
        return this.closeTerminal(this.requireId(params))
      default:
        break
    }

    const session = this.requireSession(params)

    switch (tool) {
      case 'terminal_cwd':
        return {
          cwd: session.currentCwd,
          shellName: session.shell,
          home: homedir(),
          terminalId: session.terminalId,
        } satisfies TerminalCwdResult
      case 'terminal_run':
        return this.run(toolCallId, session, params)
      case 'terminal_read': {
        const lines = Number(params.lines)
        return session.readScrollback(Number.isFinite(lines) && lines > 0 ? lines : 200)
      }
      case 'terminal_input': {
        // Input is only ever delivered to a program that already holds the
        // foreground. At a bare shell prompt these bytes would be a command
        // line, and running commands that way would bypass the capture and
        // status tracking that terminal_run provides.
        if (!session.isBusy) {
          throw new TerminalError(
            'INVALID_REQUEST',
            'Nothing is running in that terminal, so there is nothing to type into. Use terminal_run to run a command.'
          )
        }
        // Every input returns the screen it produced. Reporting only "sent"
        // lets the model assume its message went through and start waiting on
        // a reply to text still sitting unsubmitted in a composer; the screen
        // is the evidence of what the program actually did with the input.
        if (isTerminalControlKey(params.key)) {
          session.sendKey(params.key)
          await delay(INPUT_ECHO_MS)
          return { sent: params.key, ...session.readScrollback(INPUT_SCREEN_LINES) }
        }
        if (typeof params.text === 'string') {
          await session.type(params.text)
          await delay(INPUT_ECHO_MS)
          return { sent: params.text, ...session.readScrollback(INPUT_SCREEN_LINES) }
        }
        throw new TerminalError('INVALID_REQUEST', 'terminal_input needs either `text` or `key`.')
      }
      case 'terminal_kill': {
        const signal = params.signal
        const resolved =
          signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT' ? signal : 'SIGINT'
        session.kill(resolved)
        return { signal: resolved, terminalId: session.terminalId }
      }
      default:
        throw new TerminalError('INVALID_REQUEST', `Unknown terminal tool: ${tool}`)
    }
  }

  private async run(
    toolCallId: string,
    session: TerminalSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const command = typeof params.command === 'string' ? params.command.trim() : ''
    if (!command) {
      throw new TerminalError('INVALID_REQUEST', 'terminal_run needs a `command`.')
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
        `"${session.foreground}" is still running in that terminal. Poll it with terminal_read, stop it with terminal_kill, or open another terminal with terminal_new.`
      )
    }

    // How long to hold the turn before handing a still-running command back
    // for the agent to poll.
    const requested = Number(params.waitSeconds)
    const waitMs =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested * 1000, MAX_RUN_WAIT_MS)
        : DEFAULT_RUN_WAIT_MS

    return session.runCommand(command, toolCallId, waitMs)
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
  private requireSession(params: Record<string, unknown>): TerminalSession {
    const requested = typeof params.terminalId === 'string' ? params.terminalId : null
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

  private requireId(params: Record<string, unknown>): string {
    const terminalId = typeof params.terminalId === 'string' ? params.terminalId.trim() : ''
    if (!terminalId) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'This tool needs a `terminalId` from terminal_list.'
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
