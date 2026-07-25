/**
 * Shared types for the Sim agent terminal — the interactive shells built into
 * the Sim desktop app.
 *
 * The Sim web app (renderer) drives real PTYs through the desktop preload
 * bridge (`window.simDesktop.terminal`); the Electron main process owns the
 * `node-pty` processes and streams their bytes back for xterm.js to render.
 * The user and the agent share the same shells, so `cd`, exported variables,
 * and scrollback are common to both.
 *
 * Several terminals can be open at once, each its own shell with its own
 * working directory and scrollback, exactly like tabs in a terminal app. One is
 * active at a time; agent tools act on the active one unless they name another.
 *
 * Tool names and parameter shapes mirror the mothership tool catalog
 * (`copilot/internal/tools/catalog/terminal` in the mothership repo) — that
 * catalog is the source of truth for what the model can call; this package is
 * the source of truth for how those calls travel to the desktop main process.
 */

/** The single tool the model calls; what it does is in `operation`. */
export const TERMINAL_TOOL_NAME = 'terminal'

/**
 * Names this surface used to expose, one tool per operation. Kept so rows in
 * conversations recorded before the consolidation still render with a real
 * title instead of a humanized tool name.
 */
export const LEGACY_TERMINAL_TOOL_NAMES = [
  'terminal_run',
  'terminal_input',
  'terminal_read',
  'terminal_kill',
  'terminal_cwd',
  'terminal_list',
  'terminal_new',
  'terminal_switch',
  'terminal_close',
] as const

export type LegacyTerminalToolName = (typeof LEGACY_TERMINAL_TOOL_NAMES)[number]

/**
 * What one `terminal` call does.
 *
 * The first group acts on a shell — or, when that shell has tmux attached, on
 * a pane inside it. The second group manages Sim's own tabs. `panes` is the
 * one tmux-only operation: tmux owns its windows and splits, so the agent
 * inspects them rather than Sim mirroring them into the tab strip. `handoff`
 * gives the terminal to the user and waits.
 */
export const TERMINAL_OPERATIONS = [
  'run',
  'read',
  'input',
  'kill',
  'cwd',
  'list',
  'new',
  'switch',
  'close',
  'panes',
  'handoff',
] as const

export type TerminalOperation = (typeof TERMINAL_OPERATIONS)[number]

const TERMINAL_OPERATION_SET: ReadonlySet<string> = new Set(TERMINAL_OPERATIONS)

export function isTerminalOperation(value: unknown): value is TerminalOperation {
  return typeof value === 'string' && TERMINAL_OPERATION_SET.has(value)
}

export function isTerminalToolName(name: string): boolean {
  return name === TERMINAL_TOOL_NAME
}

/**
 * Ceiling on concurrently open terminals. Each is a live shell process with its
 * own emulator and scrollback, so the cap bounds both memory and the number of
 * things the user has to keep track of.
 */
export const MAX_TERMINALS = 8

/**
 * Largest command output handed back to the model, in characters. Output past
 * this is middle-elided (head and tail kept) because the interesting parts of
 * a long build log are the command echo and the failure at the end.
 */
export const MAX_TOOL_OUTPUT_CHARS = 30_000

/** Scrollback the main process retains per terminal for reads and repaints. */
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

export const MAX_RUN_WAIT_MS = 120_000

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

/**
 * Ceiling on one batch of keystrokes. Long enough to cross a menu, short
 * enough that a mistaken batch cannot run away with the program — every key
 * after the first is sent without seeing what the last one did.
 */
export const MAX_INPUT_KEYS = 20

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

export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL'

/**
 * Arguments for every operation, flattened into one object.
 *
 * A flat bag rather than a discriminated union because it has to survive a
 * round trip through a JSON tool schema, where the model supplies whichever
 * fields its chosen operation needs. Each operation validates the ones it
 * requires and ignores the rest.
 */
export interface TerminalToolArgs {
  /** `run`: the command line to execute. */
  command?: string
  /** `input`: literal text to type. */
  text?: string
  /** `input`: a key to press instead of text. */
  key?: TerminalControlKey
  /**
   * `input`: several keys pressed in order, for stepping through a menu
   * ("down", "down", "enter") without a round trip per keystroke. Each is a
   * real keypress with a pause between, so the program redraws as it would
   * under a person's hands. Capped at {@link MAX_INPUT_KEYS}.
   */
  keys?: TerminalControlKey[]
  /** `read`: trailing lines to return. */
  lines?: number
  /** `kill`: which signal. Defaults to SIGINT. */
  signal?: TerminalSignal
  /** `new`: directory to open in. Defaults to the active terminal's cwd. */
  cwd?: string
  /** `run`: how long to wait before handing back a still-running command. */
  waitSeconds?: number
  /**
   * Which terminal to act on. Omitting it targets the active one, which is
   * what the user is looking at and what a single-terminal conversation
   * always means.
   */
  terminalId?: string
  /**
   * Which tmux pane to act on, as a tmux target (`session:window.pane`), for
   * a terminal that has tmux attached. Omitting it uses that session's active
   * pane. Ignored when the terminal is a plain shell.
   */
  pane?: string
  /** `handoff`: what the user needs to do, shown on the chip they click. */
  reason?: string
}

export interface TerminalToolCall {
  operation: TerminalOperation
  args?: TerminalToolArgs
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
  terminalId: string
  /** Set when the command ran in tmux: the target it ran under. */
  pane?: string
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
  /**
   * The screen as text. When a row is highlighted the way a menu marks its
   * selection, it is prefixed `[selected] ` — a TUI that indicates the current
   * row with colour alone is otherwise invisible in plain text, leaving the
   * agent unable to tell where it is before it starts pressing keys.
   */
  output: string
  cwd: string | null
  terminalId: string
  /** Set when the read came from tmux: the pane it captured. */
  pane?: string
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
  terminalId: string
}

/** One open terminal, as shown in the tab strip. */
export interface TerminalTabState {
  terminalId: string
  /** Short label for the tab: the running command, else the cwd's basename. */
  title: string
  cwd: string | null
  /** Command holding the foreground, when one is running. */
  running: string | null
  /**
   * True while a full-screen program owns the terminal. Distinct from merely
   * `running`: a build is transient work, an editor or coding agent is an open
   * application that will sit there until it is quit.
   */
  interactive: boolean
  active: boolean
  /**
   * The tmux session attached in this terminal, when one is. Its windows and
   * panes are tmux's to manage — `panes` lists them; Sim's tab strip stays a
   * count of the shells Sim opened.
   */
  tmuxSession?: string | null
}

/** One tmux pane, as reported by the `panes` operation. */
export interface TerminalPaneState {
  /** tmux target (`session:window.pane`), usable as the `pane` argument. */
  target: string
  windowName: string
  /** The process tmux reports in the pane; a bare shell means it is idle. */
  command: string
  cwd: string | null
  active: boolean
}

/**
 * The outcome of handing a terminal to the user.
 *
 * Resolves when the command that was blocking finishes, so the agent picks up
 * where it left off rather than having to guess whether the user is done. A
 * command still going after the user says they have finished comes back with
 * `running` set, which is the same poll-it signal a long `run` returns.
 */
export interface TerminalHandoffResult {
  terminalId: string
  reason: string
  /** True when the user pressed the hand-back button rather than the command just ending. */
  handedBack: boolean
  /** The command still holding the terminal, or null when it is back at a prompt. */
  running: string | null
  /** The screen as it stands now. */
  output: string
  cwd: string | null
}

export interface TerminalPanesResult {
  terminalId: string
  session: string
  panes: TerminalPaneState[]
}

export interface TerminalTabsState {
  tabs: TerminalTabState[]
  activeTerminalId: string | null
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
  /** Another command already holds the foreground in that terminal. */
  | 'BUSY'
  | 'TIMEOUT'
  /**
   * The shell never emitted integration markers, so command boundaries and
   * exit codes are unknowable and `terminal_run` must refuse rather than guess.
   */
  | 'NO_SHELL_INTEGRATION'
  | 'SPAWN_FAILED'
  /** No terminal with that id — the ids come from terminal_list. */
  | 'NO_SUCH_TERMINAL'
  /** Already at {@link MAX_TERMINALS}. */
  | 'TOO_MANY_TERMINALS'
  /** The operation needs tmux, and this terminal has no tmux attached. */
  | 'NO_TMUX'
  /** No pane with that target — the targets come from the `panes` operation. */
  | 'NO_SUCH_PANE'
  | 'INVALID_REQUEST'

export interface TerminalStartOptions {
  cols: number
  rows: number
}

/** One batch of PTY bytes, tagged with the terminal that produced it. */
export interface TerminalOutputEvent {
  terminalId: string
  data: string
}

/**
 * Command lifecycle, used by the panel to attribute rows to the agent and to
 * show a running indicator. Emitted for user-typed commands too (no
 * `toolCallId`), so the agent's `terminal_read` and the user's view agree.
 */
export interface TerminalCommandEvent {
  terminalId: string
  phase: 'start' | 'end'
  command: string
  /** Set when the agent initiated this command rather than the user. */
  toolCallId?: string
  exitCode?: number
  durationMs?: number
}
