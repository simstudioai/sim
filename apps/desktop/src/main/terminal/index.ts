/**
 * The agent-terminal service: session lifecycle and tool execution.
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
  type TerminalCommandEvent,
  type TerminalCwdResult,
  type TerminalErrorCode,
  type TerminalSessionState,
  type TerminalStartOptions,
  type TerminalToolName,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import { TerminalSession, toKeystrokes } from '@/main/terminal/session'

const logger = createLogger('DesktopTerminal')

/**
 * How long to let a just-spawned shell finish its startup files before
 * concluding it has no integration. Generous because a heavy `.zshrc`
 * (nvm, pyenv, starship) can take a while on a cold start.
 */
const SHELL_INTEGRATION_TIMEOUT_MS = 8_000

const CLOSED_STATE: TerminalSessionState = {
  alive: false,
  cwd: null,
  shellName: null,
  shellIntegration: false,
  foregroundCommand: null,
  cols: 80,
  rows: 24,
}

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
  data(data: string): void
  /**
   * Full scrollback for a freshly mounted panel to repaint from. The renderer
   * clears before writing it, so anything it painted beforehand is discarded
   * and cannot duplicate.
   */
  replay(data: string): void
  state(state: TerminalSessionState): void
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
  private session: TerminalSession | null = null
  private sink: TerminalSink | null = null

  constructor(private readonly options: TerminalServiceOptions = {}) {}

  setSink(sink: TerminalSink | null): void {
    this.sink = sink
  }

  getState(): TerminalSessionState {
    return this.session?.state ?? CLOSED_STATE
  }

  start(options: TerminalStartOptions): TerminalSessionState {
    // Adopting a live session: the panel is mounting over a shell that has been
    // running without it, so hand back everything already on screen. A new
    // session replays nothing and the shell paints its own prompt.
    if (this.session?.state.alive) {
      const snapshot = this.session.takeReplaySnapshot()
      this.sink?.replay(snapshot)
      return this.session.state
    }

    try {
      this.session = TerminalSession.create({
        cwd: this.startingCwd(),
        cols: options.cols,
        rows: options.rows,
        callbacks: {
          onData: (data) => this.sink?.data(data),
          onState: (state) => {
            if (state.cwd) this.options.saveCwd?.(state.cwd)
            this.sink?.state(state)
          },
          onCommand: (event) => this.sink?.command(event),
        },
      })
    } catch (error) {
      throw new TerminalError('SPAWN_FAILED', (error as Error).message)
    }
    return this.session.state
  }

  write(data: string): void {
    this.session?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.session?.resize(cols, rows)
  }

  dispose(): void {
    this.session?.dispose()
    this.session = null
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
    if (tool === 'terminal_cwd') return this.describe()

    const session = this.requireSession()

    switch (tool) {
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
            'Nothing is running in the terminal, so there is nothing to type into. Use terminal_run to run a command; it is approved by the user first.'
          )
        }
        if (isTerminalControlKey(params.key)) {
          session.sendKey(params.key)
          return { sent: params.key }
        }
        if (typeof params.text === 'string') {
          session.write(toKeystrokes(params.text))
          return { sent: params.text }
        }
        throw new TerminalError('INVALID_REQUEST', 'terminal_input needs either `text` or `key`.')
      }
      case 'terminal_kill': {
        const signal = params.signal
        const resolved =
          signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT' ? signal : 'SIGINT'
        session.kill(resolved)
        return { signal: resolved }
      }
      default:
        throw new TerminalError('INVALID_REQUEST', `Unknown terminal tool: ${tool}`)
    }
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

  private describe(): TerminalCwdResult {
    const state = this.getState()
    return { cwd: state.cwd, shellName: state.shellName, home: homedir() }
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
        'Another command is already running in the terminal. Wait for it to finish, or stop it with terminal_kill.'
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

  /**
   * Returns the live session, starting one if there is none.
   *
   * A tool call must not depend on the panel having finished mounting: the
   * renderer opens the terminal resource and dispatches the tool in the same
   * tick, so the panel's own `start` usually lands after the tool arrives.
   * Spawning here removes that race — the panel adopts the session and
   * replays its scrollback whenever it does mount.
   */
  private requireSession(): TerminalSession {
    if (this.session?.state.alive) return this.session
    this.start({ cols: 80, rows: 24 })
    if (!this.session?.state.alive) {
      throw new TerminalError('SPAWN_FAILED', 'Could not open a terminal on this machine.')
    }
    return this.session
  }
}

/** Narrows an IPC payload to the tool-call shape without trusting the sender. */
export function parseToolParams(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}
