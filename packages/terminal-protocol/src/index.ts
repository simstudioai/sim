/**
 * Shared types for the Sim agent terminal — the interactive shell built into
 * the Sim desktop app.
 *
 * The Sim web app (renderer) drives a real PTY through the desktop preload
 * bridge (`window.simDesktop.terminal`); the Electron main process owns the
 * `node-pty` process and streams its bytes back for xterm.js to render. The
 * user and the agent share one shell, so `cd`, exported variables, and
 * scrollback are common to both.
 *
 * Tool names and parameter shapes mirror the mothership tool catalog
 * (`copilot/internal/tools/catalog/terminal` in the mothership repo) — that
 * catalog is the source of truth for what the model can call; this package is
 * the source of truth for how those calls travel to the desktop main process.
 */

export const TERMINAL_TOOL_NAMES = [
  'terminal_run',
  'terminal_input',
  'terminal_read',
  'terminal_kill',
  'terminal_cwd',
] as const

export type TerminalToolName = (typeof TERMINAL_TOOL_NAMES)[number]

const TERMINAL_TOOL_NAME_SET: ReadonlySet<string> = new Set(TERMINAL_TOOL_NAMES)

export function isTerminalToolName(name: string): name is TerminalToolName {
  return TERMINAL_TOOL_NAME_SET.has(name)
}

/**
 * Largest command output handed back to the model, in characters. Output past
 * this is middle-elided (head and tail kept) because the interesting parts of
 * a long build log are the command echo and the failure at the end.
 */
export const MAX_TOOL_OUTPUT_CHARS = 30_000

/** Scrollback the main process retains for `terminal_read` and panel revival. */
export const MAX_SCROLLBACK_CHARS = 256_000

/**
 * Ceiling on the raw bytes buffered while capturing one command's output. A
 * full-screen program repaints continuously and can emit megabytes a second,
 * so capture keeps a capped head plus a rolling tail rather than growing until
 * the command ends.
 */
export const MAX_CAPTURE_CHARS = 512_000

/**
 * How long `terminal_run` waits for a command before handing control back.
 *
 * Deliberately short. A long blocking call would leave the user watching
 * nothing and the agent unable to react, so anything still running comes back
 * as `running` with the output so far; the agent then polls it with `wait` and
 * `terminal_read`. Successive reads are also how it tells progress from a
 * stall — output that stops changing is a command waiting on input or wedged.
 */
export const DEFAULT_RUN_WAIT_MS = 30_000

/**
 * How long output must be silent, with the cursor left mid-line, before the
 * command is treated as sitting on a prompt and handed straight back.
 *
 * Waiting out the full window for something as obvious as `[y/n]` reads as a
 * hang. A command that stops mid-line has written a prompt and is waiting for
 * an answer; one that is merely working either keeps printing or has ended its
 * last line properly, so neither trips this.
 */
export const PROMPT_IDLE_MS = 2_500

export const MAX_RUN_WAIT_MS = 120_000

/** Control keys the agent may send to a running foreground process. */
export const TERMINAL_CONTROL_KEYS = [
  'ctrl-c',
  'ctrl-d',
  'ctrl-z',
  'enter',
  'up',
  'down',
  'left',
  'right',
  'escape',
  'tab',
] as const

export type TerminalControlKey = (typeof TERMINAL_CONTROL_KEYS)[number]

const TERMINAL_CONTROL_KEY_SET: ReadonlySet<string> = new Set(TERMINAL_CONTROL_KEYS)

export function isTerminalControlKey(value: unknown): value is TerminalControlKey {
  return typeof value === 'string' && TERMINAL_CONTROL_KEY_SET.has(value)
}

export interface TerminalRunParams {
  command: string
  waitSeconds?: number
}

export interface TerminalInputParams {
  text?: string
  key?: TerminalControlKey
}

export interface TerminalReadParams {
  /** Trailing lines of scrollback to return. */
  lines?: number
}

export interface TerminalKillParams {
  signal?: 'SIGINT' | 'SIGTERM' | 'SIGKILL'
}

/**
 * How a `terminal_run` ended. Only `completed` means the command is finished
 * and the terminal is free; in every other case it is still running and still
 * holds the foreground.
 */
export type TerminalRunStatus =
  /** Exited on its own. `exitCode` is set. */
  | 'completed'
  /**
   * Still going when the wait window elapsed. Not an error and not a stall —
   * poll it rather than re-running or giving up.
   */
  | 'running'
  /**
   * Took over the screen (an editor, pager, or interactive CLI). Its output is
   * redraws rather than text and it will not exit unaided.
   */
  | 'interactive'

export interface TerminalRunResult {
  command: string
  output: string
  status: TerminalRunStatus
  /** Null unless `status` is `completed`. */
  exitCode: number | null
  durationMs: number
  cwd: string | null
  /** True when output was elided to fit {@link MAX_TOOL_OUTPUT_CHARS}. */
  truncated: boolean
  /**
   * Set when the command looks like it is blocked on a prompt: it printed
   * something, stopped mid-line, and went quiet. Answer it with terminal_input
   * rather than waiting — it will not proceed on its own.
   */
  awaitingInput?: boolean
}

export interface TerminalReadResult {
  output: string
  cwd: string | null
  truncated: boolean
  /**
   * The command still holding the terminal, or null when the shell is back at
   * a prompt. This is the definitive "is it done" signal for a poll loop —
   * seeing expected text in the output is not, because a command can print its
   * last line well before it exits.
   */
  running: string | null
}

export interface TerminalCwdResult {
  cwd: string | null
  shellName: string | null
  home: string | null
}

/** The result of one terminal tool invocation, as returned over the bridge. */
export interface TerminalToolResponse {
  ok: boolean
  result?: unknown
  error?: string
  code?: TerminalErrorCode
}

export type TerminalErrorCode =
  | 'SESSION_CLOSED'
  /** Another command already holds the foreground. */
  | 'BUSY'
  | 'TIMEOUT'
  /**
   * The shell never emitted integration markers, so command boundaries and
   * exit codes are unknowable and `terminal_run` must refuse rather than guess.
   */
  | 'NO_SHELL_INTEGRATION'
  | 'SPAWN_FAILED'
  | 'INVALID_REQUEST'

export interface TerminalStartOptions {
  cols: number
  rows: number
}

/** Live session state pushed to the panel header. */
export interface TerminalSessionState {
  alive: boolean
  cwd: string | null
  shellName: string | null
  /**
   * True once integration markers have been seen. Until then the panel is a
   * usable terminal but the agent cannot run commands in it.
   */
  shellIntegration: boolean
  /** Command holding the foreground, when one is running. */
  foregroundCommand: string | null
  cols: number
  rows: number
}

/**
 * Command lifecycle, used by the panel to attribute rows to the agent and to
 * show a running indicator. Emitted for user-typed commands too (no
 * `toolCallId`), so the agent's `terminal_read` and the user's view agree.
 */
export interface TerminalCommandEvent {
  phase: 'start' | 'end'
  command: string
  /** Set when the agent initiated this command rather than the user. */
  toolCallId?: string
  exitCode?: number
  durationMs?: number
}
