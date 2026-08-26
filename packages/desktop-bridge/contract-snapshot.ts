/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Frozen snapshot of the desktop preload bridge type surface
 * (@sim/browser-protocol + @sim/terminal-protocol inlined into
 * @sim/desktop-bridge) as of the last accepted contract change.
 * CI type-checks that a shell built from this
 * snapshot still satisfies the current SimDesktopApi, so bridge changes
 * stay backward compatible with already-installed shells.
 *
 * Regenerate with: bun run desktop-bridge-contract:update
 * Full rules: scripts/check-desktop-bridge-contract.ts
 *
 * min-desktop-version: 0.0.0
 */
/**
 * Shared types for the Sim browser agent — the agent browser built into the
 * Sim desktop app.
 *
 * The Sim web app (renderer) invokes browser tools through the desktop
 * preload bridge (`window.simDesktop.browserAgent`); the Electron main
 * process executes them against a dedicated, persistent-profile browser view
 * that is embedded INSIDE the main Sim window, positioned exactly over the
 * chat's browser panel. The panel is therefore natively interactive — the
 * user clicks and types into the real page, no frame streaming or synthetic
 * input. Both sides consume this package so tool names, parameter shapes,
 * and result shapes cannot drift.
 *
 * Tool names and parameter shapes mirror the mothership tool catalog
 * (`copilot/internal/tools/catalog/browser` in the mothership repo) — that
 * catalog is the source of truth for what the model can call; this package is
 * the source of truth for how those calls travel to the desktop main process.
 */

export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_open_url',
  'browser_go_back',
  'browser_go_forward',
  'browser_open_tab',
  'browser_switch_tab',
  'browser_close_tab',
  'browser_list_tabs',
  'browser_list_sessions',
  'browser_wait_for',
  'browser_snapshot',
  'browser_read_text',
  'browser_screenshot',
  'browser_extract',
  'browser_click',
  'browser_click_at',
  'browser_type',
  'browser_insert_text',
  'browser_press_key',
  'browser_scroll',
  'browser_select_option',
  'browser_hover',
  'browser_drag',
  'browser_request_takeover',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export const BROWSER_THEMES = ['system', 'light', 'dark'] as const

/** Sim appearance preference mirrored into browser-tab media queries. */
export type BrowserTheme = (typeof BROWSER_THEMES)[number]

/** How a native browser shortcut should focus Sim's renderer-owned omnibox. */
export type BrowserOmniboxFocusMode = 'select' | 'clear'

const BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(BROWSER_TOOL_NAMES)
const BROWSER_THEME_SET: ReadonlySet<string> = new Set(BROWSER_THEMES)

export function isBrowserToolName(name: string): name is BrowserToolName {
  return BROWSER_TOOL_NAME_SET.has(name)
}

export function isBrowserTheme(value: unknown): value is BrowserTheme {
  return typeof value === 'string' && BROWSER_THEME_SET.has(value)
}

/** The result of one browser tool invocation, as returned over the bridge. */
export interface BrowserToolResponse {
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * Where the browser panel currently sits inside the Sim window, in CSS
 * pixels relative to the page viewport. The main process positions the
 * embedded browser view over this rect; null means the panel is not visible
 * and the view should be hidden.
 */
export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * How the panel's rect derives from the window's viewport, so the shell can
 * re-evaluate it during a live window resize instead of holding a measured
 * rect that is one frame stale.
 *
 * The renderer declares the rule; the shell only evaluates it. That direction
 * matters: the shell once *assumed* a rule (right-anchored at constant width)
 * and was wrong by half the window's travel whenever the panel was fractional.
 *
 * `widthRatio` is the only thing the shell cannot work out for itself, so it is
 * the only rule carried here. Everything else — the width residual, the right
 * inset, the top and bottom insets — the shell derives from the rect reported
 * alongside this, measured at exactly the viewport below.
 */
export interface BrowserPanelAnchor {
  /** Viewport size (CSS px) the companion rect was measured at. */
  viewportWidth: number
  viewportHeight: number
  /**
   * How much the panel's width changes per pixel of viewport width: 0.5 while a
   * half-width class governs it, 0 once a divider drag pins a fixed width.
   *
   * A rate, deliberately, not a share of the viewport — the panel is half of a
   * parent box that excludes the sidebar, so its width is not 0.5 * viewport.
   * The rate is what holds regardless, because that sidebar is a constant across
   * a window resize, and the residual the shell derives absorbs the difference.
   */
  widthRatio: number
}

/**
 * Pixel-exact browser frame displayed during a renderer-owned toolbar menu.
 * The native page stays visible until this frame has painted, then the shell
 * hides it without changing its bounds or compositor attachment.
 */
export interface BrowserPanelSnapshot {
  dataUrl: string
  tabId: string
  zoomPercent: number
  /** Chat scope that owns the captured tab. */
  scopeId: string
  /**
   * Exact native-view rectangle in the Sim renderer's viewport CSS pixels.
   *
   * The native surface is integer-positioned in Electron DIP, while its React
   * host can end on fractional CSS pixels. Rendering the replacement at this
   * viewport rectangle avoids clipping or stretching it to the host box.
   * Optional for compatibility with installed shells from before this field.
   */
  viewportBounds?: BrowserPanelBounds
}

/**
 * Browser-chrome commands from the panel header (URL bar, back/forward,
 * reload) plus `takeover-done`, sent by the question card on the chat's
 * `browser_request_takeover` tool row when the user finishes a
 * hand-control-back request. Page interactions need no protocol — the user
 * acts on the real embedded page directly, and its right-click menu is native
 * and lives entirely in the shell.
 */
export interface BrowserPanelAction {
  action:
    | 'navigate'
    | 'reload'
    | 'back'
    | 'forward'
    | 'new-tab'
    | 'duplicate-tab'
    | 'switch-tab'
    | 'close-tab'
    | 'print'
    | 'zoom-in'
    | 'zoom-out'
    | 'zoom-reset'
    | 'takeover-done'
  /** Absolute URL for `navigate` (typed into the panel's URL bar). */
  url?: string
  /** Stable tab id for `duplicate-tab`, `switch-tab`, and `close-tab`. */
  tabId?: string
  /** Optional free-text instruction submitted with `takeover-done`. */
  takeoverResponse?: string
}

/** Live state of the active page, pushed to the panel header. */
export interface BrowserPageState {
  tabId: string
  /** Chat scope that owns this page. */
  scopeId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * One find-in-page request against the active tab. Backed by Chromium's own
 * find, so behaviour matches Chrome exactly — this only carries the query and
 * which way to step.
 */
export interface BrowserFindRequest {
  query: string
  /**
   * True starts a fresh search and highlights every match; false steps to the
   * next/previous match of the search already running. This deliberately names
   * Electron's otherwise-confusing `findNext` option by what it actually does.
   */
  newSession: boolean
  /** Direction for a follow-up step. Ignored when starting a fresh search. */
  forward: boolean
}

/**
 * Match counts for the running find, pushed as Chromium resolves them. The
 * counts are asynchronous and arrive in several updates per request, so the
 * renderer must not expect one reply per {@link BrowserFindRequest}.
 */
export interface BrowserFindResult {
  /** 1-based index of the highlighted match, or 0 before one is chosen. */
  activeMatchOrdinal: number
  /** Total matches on the page; 0 means the query is not present. */
  matches: number
  /**
   * Whether the find has settled. Chromium streams provisional counts while a
   * long page is still being scanned; only a final update is worth showing as
   * a definitive "no results".
   */
  final: boolean
}

/** Summary of one live page in the desktop agent browser. */
export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  loading: boolean
  active: boolean
  /** Pinned tabs are ordered before regular tabs and cannot be closed. */
  pinned: boolean
}

/** Complete live tab list pushed by the desktop shell. */
export interface BrowserTabsState {
  tabs: BrowserTabState[]
  activeTabId: string | null
  /** Tab currently driven by the agent when it differs from the user's visible tab. */
  automationTabId?: string | null
  /** True while a browser tool is actively driving that tab. */
  automationActive?: boolean
  /** True while automation is paused for the user on this tab. */
  automationNeedsAttention?: boolean
  /** Chat scope that owns this tab set. */
  scopeId: string
}

/**
 * Why the desktop shell believes a website may have an authenticated session.
 * Neither signal is proof: the live page must always be checked before acting.
 */
export type BrowserSessionEvidence = 'sign-in-completed' | 'cookies'

/**
 * Privacy-preserving summary of one possible authenticated website. Cookie
 * names, values, paths, account identifiers, and page history never cross the
 * desktop bridge.
 */
export interface BrowserKnownSession {
  hostname: string
  evidence: BrowserSessionEvidence
  lastObservedAt: string
}

export interface BrowserKnownSessionsState {
  sessions: BrowserKnownSession[]
}

export const BROWSER_DATA_KINDS = ['cookies', 'site-data', 'cache'] as const

/**
 * A kind of browsing data the user can clear independently.
 *
 * Download history is deliberately absent: the built-in browser cancels every
 * download, so there is none to clear and offering the option would be a lie.
 * Saved passwords are absent too — they are a separate, explicit action.
 */
export type BrowserDataKind = (typeof BROWSER_DATA_KINDS)[number]

const BROWSER_DATA_KIND_SET: ReadonlySet<string> = new Set(BROWSER_DATA_KINDS)

export function isBrowserDataKind(value: unknown): value is BrowserDataKind {
  return typeof value === 'string' && BROWSER_DATA_KIND_SET.has(value)
}

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
 * Terminal tabs have no fixed app-level limit. Each is its own shell with its
 * own working directory and scrollback, exactly like tabs in a terminal app.
 * One is active at a time; agent tools act on the active one unless they name
 * another.
 *
 * Tool names and parameter shapes mirror the mothership tool catalog
 * (`copilot/internal/tools/catalog/terminal` in the mothership repo) — that
 * catalog is the source of truth for what the model can call; this package is
 * the source of truth for how those calls travel to the desktop main process.
 */

import { truncate } from '@sim/utils/string'

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

/** Longest program name {@link describeRunningCommand} will return. */
const MAX_RUNNING_COMMAND_LABEL = 32

/**
 * Shell words that precede the program rather than being it, so a label reads
 * `claude` and not `env` or `sudo`.
 */
const COMMAND_PREFIX_WORDS = new Set([
  'command',
  'doas',
  'env',
  'exec',
  'nice',
  'nohup',
  'sudo',
  'time',
])

/** `NAME=value`, the other thing that can sit in front of the program. */
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The last command in a shell line, ignoring separators inside quotes. A
 * quote-blind split would cut `claude "a && b"` in half and report `b"` as the
 * program.
 */
function lastCommandSegment(command: string): string {
  let start = 0
  let quote: "'" | '"' | null = null
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote) {
      // Only double quotes honor backslash escapes; inside single quotes a
      // backslash is a literal character and cannot hide the closing quote.
      if (char === '\\' && quote === '"') index++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\') {
      index++
      continue
    }
    if (char === ';' || char === '&' || char === '|') {
      if (command[index + 1] === char) index++
      start = index + 1
    }
  }
  return command.slice(start).trim()
}

/**
 * A short name for whatever is holding a terminal's foreground.
 *
 * `running` is the literal line the shell was given, and an agent-launched one
 * runs long: `cd <path> && export PATH=<path> && claude "<the whole prompt>"`
 * is a single command several hundred characters wide. That is the right thing
 * to hand an agent and the wrong thing to put in a sentence — a confirmation
 * built around it stops being a question and becomes a wall of shell. This
 * keeps the part a person recognizes, the program they are waiting on, and
 * drops the environment preamble around it.
 *
 * Best-effort by construction: the input is a shell line, not a parsed argv,
 * so a command this cannot read falls back to the line itself, bounded. Use it
 * for prose about a terminal, never to decide anything.
 *
 * @example
 * describeRunningCommand('cd /repo && export PATH=/bin && claude "fix it"') // 'claude'
 * describeRunningCommand('sudo /usr/bin/docker compose up')                 // 'docker'
 */
export function describeRunningCommand(running: string): string {
  const line = running.trim()
  if (!line) return 'a command'

  const segment = lastCommandSegment(line) || line
  const program = segment
    .split(/\s+/)
    .filter(Boolean)
    .find(
      (word) =>
        !ENVIRONMENT_ASSIGNMENT.test(word) &&
        !COMMAND_PREFIX_WORDS.has(word) &&
        !word.startsWith('-')
    )

  const label =
    (program
      ? (program
          .replace(/^['"]|['"]$/g, '')
          .split('/')
          .filter(Boolean)
          .pop() ?? '')
      : '') || segment
  return truncate(label, MAX_RUNNING_COMMAND_LABEL, '…')
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
  /** Terminal currently driven by the agent when it differs from the user's visible terminal. */
  agentActiveTerminalId?: string | null
}

/** A tab strip crossing the desktop bridge, tagged with its owning chat. */
export interface ScopedTerminalTabsState extends TerminalTabsState {
  scopeId: string
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

/** A command event crossing the desktop bridge, tagged with its owning chat. */
export interface ScopedTerminalCommandEvent extends TerminalCommandEvent {
  scopeId: string
}

export const PENDING_DESKTOP_SCOPE_PREFIX = 'pending:' as const

const DESKTOP_SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const PENDING_DESKTOP_SCOPE_PATTERN = /^pending:[A-Za-z0-9_-]{1,128}$/

/** True for a durable chat id or the provisional id used while creating one. */
export function isDesktopScopeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (DESKTOP_SCOPE_PATTERN.test(value) || PENDING_DESKTOP_SCOPE_PATTERN.test(value))
  )
}

export function isPendingDesktopScopeId(scopeId: string): boolean {
  return scopeId.startsWith(PENDING_DESKTOP_SCOPE_PREFIX)
}

/**
 * The agent-terminal surface of the preload bridge. Real PTYs run in the
 * Electron main process; the renderer paints their bytes with xterm.js and
 * forwards keystrokes back. Several terminals can be open at once, each its own
 * shell, and the user and the agent share them — so working directory and
 * environment stay consistent between the two.
 */
export interface SimDesktopTerminalApi {
  /** Open the first terminal, or adopt the ones already running. */
  start(options: TerminalStartOptions, scopeId: string): Promise<ScopedTerminalTabsState>
  /**
   * Execute one terminal operation. Resolves with the outcome; never rejects
   * for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs,
    scopeId: string
  ): Promise<TerminalToolResponse>
  /** Forward the user's keystrokes to one terminal's PTY. */
  write(terminalId: string, data: string, scopeId: string): void
  /**
   * Paste the system clipboard into one terminal's PTY.
   *
   * The text is read in the main process rather than handed over by the caller:
   * Electron removed the `clipboard` module from renderers precisely so page
   * content cannot reach the clipboard, and it means a compromised renderer can
   * only replay what the user already copied instead of choosing the bytes.
   * Resolves false when the clipboard held nothing to paste.
   */
  paste(terminalId: string, scopeId: string): Promise<boolean>
  resize(terminalId: string, cols: number, rows: number, scopeId: string): void
  /** Open an additional terminal and make it active. */
  openTerminal(cwd: string | undefined, scopeId: string): Promise<ScopedTerminalTabsState>
  switchTerminal(terminalId: string, scopeId: string): Promise<ScopedTerminalTabsState>
  /** Move a terminal to its final position. Optional for older installed shells. */
  reorderTerminal?(
    terminalId: string,
    targetIndex: number,
    scopeId: string
  ): Promise<ScopedTerminalTabsState>
  closeTerminal(terminalId: string, scopeId: string): Promise<ScopedTerminalTabsState>
  getTabs(scopeId: string): Promise<ScopedTerminalTabsState>
  /** Makes a chat's terminal group the renderer-visible group. */
  activateScope(scopeId: string): Promise<ScopedTerminalTabsState>
  /** Moves a pending new-chat terminal group onto its assigned chat id. */
  migrateScope(fromScopeId: string, toScopeId: string): Promise<ScopedTerminalTabsState>
  /** Abandons a provisional new-chat terminal group and its fresh shells. */
  disposeScope(scopeId: string): Promise<boolean>
  /** Stops a soft-deleted chat's shells while retaining its restart descriptor. */
  suspendScope(scopeId: string): Promise<boolean>
  /** End every shell. A new one starts on the next `start`. */
  dispose(): void
  /** Subscribe to PTY output batches. Returns an unsubscribe function. */
  onData(callback: (terminalId: string, data: string, scopeId: string) => void): () => void
  /**
   * Everything already on a terminal's screen, for a new view to paint itself
   * from. Pulled per view so the repaint cannot be aimed at the wrong set of
   * subscribers, or at none at all.
   */
  getScrollback(terminalId: string, scopeId: string): Promise<string>
  /** Forget retained output for one terminal. */
  clearScrollback(terminalId: string, scopeId: string): Promise<boolean>
  /**
   * Reports whether the visible terminal panel owns resource shortcuts, so a
   * transient DOM blur cannot turn Cmd-W into a window-level command.
   */
  setFocused(focused: boolean, scopeId: string): void
  /** Reports whether this renderer is currently displaying the terminal resource. */
  setVisible?(visible: boolean, scopeId: string): void
  /**
   * The user finishing a handoff — the hand-back chip on the waiting tool row.
   */
  finishHandoff(terminalId: string, scopeId: string): void
  /** Subscribe to the open-terminal list and which one is active. */
  onTabs(callback: (state: ScopedTerminalTabsState) => void): () => void
  /** Subscribe to command start/end, used for agent attribution in the panel. */
  onCommand(callback: (event: ScopedTerminalCommandEvent) => void): () => void
  /** Subscribe to focus-routed terminal commands from desktop menu accelerators. */
  onShortcutCommand(
    callback: (command: TerminalShortcutCommand, scopeId: string, terminalId?: string) => void
  ): () => void
  /** Subscribe when the device-wide terminal zoom baseline changes. */
  onDefaultZoomChanged(callback: (zoom: DesktopZoomPercent) => void): () => void
  /** Subscribe when a task's live PTYs are stopped but its restart descriptor is retained. */
  onScopeSuspended(callback: (scopeId: string) => void): () => void
}

/**
 * The browser-agent surface of the preload bridge. Tools execute in the
 * Electron main process against the desktop app's built-in agent browser — a
 * persistent-profile browser view embedded in the main Sim window, positioned
 * over the chat's browser panel so the user interacts with the real page.
 */
export interface SimDesktopBrowserAgentApi {
  /** New shells can atomically force-hide a native page before renderer effects paint. */
  readonly supportsAtomicPanelOcclusion?: true
  /**
   * Execute one browser tool. Resolves with the tool's outcome; never
   * rejects for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    tool: BrowserToolName,
    params: Record<string, unknown>,
    scopeId: string
  ): Promise<BrowserToolResponse>
  /** Cancel one exact in-flight tool. Optional for compatibility with older shells. */
  cancelTool?(toolCallId: string, scopeId: string): Promise<boolean>
  /** Cancel the currently active tool in a scope after renderer state was lost. */
  cancelActiveTool?(scopeId: string): Promise<boolean>
  /** Browser-chrome commands from the panel (URL bar, back, reload, takeover hand-back). */
  panelAction(action: BrowserPanelAction, scopeId: string): void
  /**
   * Create and activate a blank tab, returning the authoritative list.
   * Optional for compatibility with installed shells that predate acknowledged tab creation.
   */
  openTab?(scopeId: string): Promise<BrowserTabsState>
  /** Makes a chat's browser tab set the renderer-visible set. */
  activateScope(scopeId: string): Promise<BrowserTabsState>
  /** Materializes a lazily activated chat's persisted tabs without showing its panel. */
  restoreScope(scopeId: string): Promise<BrowserTabsState>
  /** Moves a pending new-chat browser set onto its assigned chat id. */
  migrateScope(fromScopeId: string, toScopeId: string): Promise<BrowserTabsState>
  /** Abandons a provisional new-chat browser set and its local descriptor. */
  disposeScope(scopeId: string): Promise<boolean>
  /** Closes a soft-deleted chat's live pages while retaining its restart descriptor. */
  suspendScope(scopeId: string): Promise<boolean>
  /** Pin or unpin a live browser tab. */
  setTabPinned(tabId: string, pinned: boolean, scopeId: string): void
  /** Opens the native tab actions menu without covering the embedded page. */
  showTabContextMenu(tabId: string, scopeId: string): void
  /** Move a live tab to a final list index. */
  reorderTab(tabId: string, targetIndex: number, scopeId: string): void
  /**
   * Report where the browser panel sits in the window (CSS pixels relative
   * to the viewport), or null when the panel is hidden/unmounted. The main
   * process keeps the embedded view glued to this rect.
   *
   * `anchor` declares how that rect derives from the viewport so the shell can
   * re-evaluate it mid-resize rather than hold a stale rect; null falls back to
   * the measured rect alone.
   */
  setPanelBounds(
    bounds: BrowserPanelBounds | null,
    anchor: BrowserPanelAnchor | null,
    scopeId: string
  ): void
  /** Capture the current page before opening renderer-owned UI above it. */
  capturePanelSnapshot(scopeId: string): Promise<BrowserPanelSnapshot | null>
  /** Hide/reveal the native page after its replacement frame has painted. */
  setPanelOccluded(occluded: boolean, scopeId: string, force?: boolean): Promise<boolean>
  /** Report whether renderer-owned browser chrome owns the user's interaction context. */
  setPanelFocused(focused: boolean, scopeId: string): void
  /** Mirror Sim's light/dark/system preference into embedded pages. */
  setTheme(theme: BrowserTheme): void
  /**
   * Focus requests emitted by native tabs for browser-level keyboard
   * shortcuts such as Mod+L and Mod+T.
   */
  onFocusOmnibox(callback: (mode: BrowserOmniboxFocusMode, scopeId: string) => void): () => void
  /**
   * Run Chromium's find-in-page against the active tab. Results do not come
   * back from this call — they stream through {@link onFindResult}.
   */
  find(request: BrowserFindRequest, scopeId: string): void
  /**
   * Stop the running find and clear its highlights. `focusPage` hands keyboard
   * focus back to the page, for the user dismissing the bar; omit it when the
   * bar is going away because the panel is.
   */
  stopFind(focusPage: boolean, scopeId: string): void
  /**
   * Mod+F pressed while the embedded page had focus, which the renderer never
   * sees as a key event. Opening the find bar is the renderer's job either
   * way, so both entry paths land on the same handler.
   */
  onOpenFind(callback: (scopeId: string) => void): () => void
  /**
   * The shell dismissing the find bar — the active tab navigated away from the
   * document the find was run against, or the user switched tabs.
   */
  onCloseFind(callback: (scopeId: string) => void): () => void
  /** Match counts for the running find, as Chromium resolves them. */
  onFindResult(callback: (result: BrowserFindResult, scopeId: string) => void): () => void
  /** Subscribe to live page state for the panel header. Returns an unsubscribe function. */
  onPageState(callback: (state: BrowserPageState) => void): () => void
  /** Read the current live tab list. */
  getTabsState(scopeId: string): Promise<BrowserTabsState>
  /** Read a privacy-preserving hint of websites that may have a usable session. */
  getKnownSessions(): Promise<BrowserKnownSessionsState>
  /**
   * Live search completions for the omnibox. Optional while installed shells
   * that predate search suggestions remain supported.
   */
  getSearchSuggestions?(query: string): Promise<string[]>
  /**
   * Erase browsing data from the dedicated profile and resolve the resulting
   * session list. Pass the kinds to clear; omit for all of them. Saved
   * passwords are never included — deleting those is a separate action.
   */
  clearBrowsingData(kinds?: readonly BrowserDataKind[]): Promise<BrowserKnownSessionsState>
  /** Recent downloads owned by one chat's isolated browser session. */
  getDownloadsState(scopeId: string): Promise<BrowserDownloadsState>
  /** Opens the native recent-downloads menu at a point in the app window. */
  showDownloadsMenu(anchor: { x: number; y: number }, scopeId: string): Promise<boolean>
  /** Opens the native browser overflow menu at a point in the app window. */
  showToolbarMenu(anchor: { x: number; y: number }, scopeId: string): Promise<boolean>
  /** Reveals one completed download in Finder or the platform file manager. */
  showDownloadInFolder(downloadId: string, scopeId: string): Promise<boolean>
  /** Subscribe to download starts, progress, and completion for the active chat. */
  onDownloadsState(callback: (state: BrowserDownloadsState) => void): () => void
  /** Subscribe to settings/navigation actions chosen from the native toolbar menu. */
  onToolbarCommand(callback: (command: BrowserToolbarCommand, scopeId: string) => void): () => void
  /** Subscribe when selected page text is attached to the owning chat input. */
  onAddToChat(callback: (payload: BrowserAddToChatPayload) => void): () => void
  /** Subscribe when the device-level browser appearance preference changes. */
  onAppearanceThemeChanged(callback: (theme: DesktopAppearanceTheme) => void): () => void
  /** Subscribe to live tab-list changes. */
  onTabsState(callback: (state: BrowserTabsState) => void): () => void
  /**
   * Subscribe to session liveness changes (false when the browser session
   * ends). Returns an unsubscribe function.
   */
  onSessionStatus(callback: (alive: boolean, scopeId: string) => void): () => void
  /** Subscribe when a task's live pages close but its restart descriptor is retained. */
  onScopeSuspended(callback: (scopeId: string) => void): () => void
}

export type BrowserDownloadState = 'progressing' | 'completed' | 'interrupted' | 'cancelled'

/** Safe renderer metadata for a native browser download; host paths never cross the bridge. */
export interface BrowserDownloadInfo {
  id: string
  filename: string
  state: BrowserDownloadState
  receivedBytes: number
  totalBytes: number
  startedAt: string
}

/** The newest downloads for one browser scope, newest first. */
export interface BrowserDownloadsState {
  downloads: BrowserDownloadInfo[]
  scopeId: string
}

/** Renderer navigation requested by the native browser toolbar menu. */
export type BrowserToolbarCommand = 'browser-settings' | 'import'

/** Selected text and live page identity handed from the native browser to Sim. */
export interface BrowserAddToChatPayload {
  text: string
  tabId: string
  /** Current public web address. Omitted for non-http(s) pages. */
  url?: string
  title?: string
  scopeId: string
}

/**
 * One browser profile found on this device.
 *
 * `id` is an opaque handle used to name the same profile back to the shell;
 * the shell resolves it against the profiles it discovered rather than
 * building a path from it. Host paths never cross this bridge.
 *
 */
export interface BrowserImportProfile {
  id: string
  /** Browser and profile together, e.g. `Arc · Microtrades`. */
  label: string
  /** Stable browser identifier, e.g. `chrome`, `arc`, `brave`. */
  browserId: string
  /** The browser's product name, e.g. `Arc`. */
  browserLabel: string
  /** The profile on its own, e.g. `Microtrades` or `Default`. */
  profileLabel: string
}

/**
 * Why an import could not run, as a coarse category. Deliberately free of
 * specifics: no host paths, profile paths, domains, or underlying OS errors.
 */
export type BrowserImportError =
  | 'unsupported-platform'
  | 'chrome-not-found'
  | 'keychain-unavailable'
  | 'profile-unreadable'
  | 'unsupported-schema'
  | 'nothing-imported'
  | 'vault-unavailable'
  | 'unknown'

/**
 * Outcome of a Chrome import: counts and a coarse error category only. Cookie
 * names, values, domains, and full URLs never cross the bridge — they never
 * leave the Electron main process at all.
 */
export interface BrowserImportResult {
  cookiesImported: number
  cookiesSkipped: number
  /** Present only when the import could not complete. */
  error?: BrowserImportError
}

/**
 * Local, user-initiated import of Chrome data into the built-in browser's
 * dedicated profile. macOS-only today; shells on platforms without a
 * supported importer omit the entire surface.
 *
 * The agent cannot reach this. Both methods are gated in the main process to
 * the Sim app origin, `importChromeCookies` additionally requires a live user
 * gesture, and no browser tool maps to either channel. Reading Chrome is
 * strictly read-only, and decrypted material stays in the main process.
 */
/** A site a previous import brought over, keyed by the hostname visited there. */
export interface BrowserSiteInfo {
  hostname: string
  /** Learned from the source browser's own page titles, not a built-in list. */
  name?: string
  /** The source browser's favicon, as a `data:` URL. */
  icon?: string
  /**
   * How much the site was used in the browser it came from — an aggregate for
   * ordering suggestions, never a visit time, a URL, or a sequence. Absent on
   * a record written before imports started counting.
   */
  visits?: number
  /** When Sim imported it; never the source browser's own last-visit time. */
  importedAt?: string
}

export interface SimDesktopBrowserImportApi {
  /** Chrome profiles detected on this device; empty when none are readable. */
  listChromeProfiles(): Promise<BrowserImportProfile[]>
  /**
   * The sites previous imports brought over, so the omnibox has somewhere to
   * start on a browser that keeps no history of its own — and can offer
   * "Gmail" instead of `mail.google.com`.
   */
  listSites(): Promise<BrowserSiteInfo[]>
  /**
   * Copy one Chrome profile's cookies into the built-in browser, preserving
   * each cookie's security attributes. Requires an active user gesture in the
   * calling page. Resolves a count-only report; never rejects for import-level
   * failures (those ride the `error` category).
   */
  importChromeCookies(profileId?: string): Promise<BrowserImportResult>
  /**
   * Copy cookies and saved passwords in one action.
   *
   * A single call rather than two, because the macOS Keychain prompt can
   * outlive the page's transient user activation and a second gated call would
   * then be refused for a user who did nothing wrong. Each half reports its
   * own outcome, so one failing does not hide the other.
   *
   */
  importFromChrome(
    profileId?: string,
    policy?: BrowserCredentialConflictPolicy
  ): Promise<BrowserChromeImportResult>
}

/** Both halves of a combined Chrome import, each with its own outcome. */
export interface BrowserChromeImportResult {
  cookies: BrowserImportResult
  passwords: BrowserPasswordImportResult
}

/** How an import should treat a credential that already exists for a site. */
export type BrowserCredentialConflictPolicy = 'keep-existing' | 'replace'

/**
 * Outcome of a password import. Counts and a coarse category only, exactly
 * like the cookie import — no origins, usernames, or passwords.
 */
export interface BrowserPasswordImportResult {
  passwordsAdded: number
  passwordsUpdated: number
  passwordsSkipped: number
  error?: BrowserImportError
}

/**
 * One saved credential as the management UI sees it. The password is
 * deliberately absent, and there is no bridge method that can produce it:
 * plaintext only ever travels from the vault to an authorized fill, inside the
 * main process.
 */
export interface BrowserCredentialMetadata {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
  source: 'chrome' | 'manual'
  /**
   * The site's icon as a `data:` URL, copied from the source browser's own
   * favicon store during import. Absent when that browser had no icon for the
   * site. Never fetched over the network — doing so would disclose the list of
   * sites the user has passwords for.
   */
  icon?: string
}

/**
 * Whether the active browser tab is showing a login form that Sim holds a
 * credential for — just enough to decide whether to offer the fill affordance.
 *
 * Intentionally carries only the boolean and its opaque chat scope. Matching
 * accounts are requested separately and only in response to opening the
 * chooser, while password plaintext never crosses this bridge on the fill
 * path.
 */
export interface BrowserFillAvailability {
  available: boolean
  /** Chat scope owning the page whose availability was measured. */
  scopeId: string
}

/**
 * The saved-password surface for the built-in browser: an OS-encrypted local
 * vault plus a user-driven fill.
 *
 * The surface remains present when secure storage is unavailable and reports
 * that state through {@link SimDesktopBrowserCredentialsApi.isAvailable};
 * there is no plaintext fallback. The agent has no path to any of it:
 * management calls require the Sim app origin, filling additionally requires
 * a real user gesture, and no browser tool maps to these channels.
 */
export interface SimDesktopBrowserCredentialsApi {
  /** False when OS-backed encryption is unavailable and passwords are disabled. */
  isAvailable(): Promise<boolean>
  /** Saved credentials, without passwords. */
  list(): Promise<BrowserCredentialMetadata[]>
  /** Forget one credential; resolves the remaining list. */
  forget(id: string): Promise<BrowserCredentialMetadata[]>
  /** Delete every saved password; resolves the resulting empty list. */
  forgetAll(): Promise<BrowserCredentialMetadata[]>
  /**
   * Reveal one saved password so the user can read it.
   *
   * This is the only method on the entire bridge that can produce password
   * plaintext, and it is heavily conditioned: it requires an active user
   * gesture, the shell prompts for Touch ID (or a native confirmation where
   * Touch ID is unavailable) on every call, and it returns exactly one
   * password. Resolves null when the user declines or the credential is gone.
   */
  reveal(id: string): Promise<string | null>
  /**
   * Copy one saved password to the clipboard. Same authorization as
   * {@link reveal}, but the password never enters the renderer: the shell
   * writes the clipboard itself and clears it again shortly after.
   */
  copy(id: string): Promise<boolean>
  /** Copy saved passwords out of a Chrome profile into the vault. */
  importFromChrome(
    profileId?: string,
    policy?: BrowserCredentialConflictPolicy
  ): Promise<BrowserPasswordImportResult>
  /**
   * Ask the shell to show its native credential chooser near a point in the
   * window. Requires a user gesture. The shell performs the fill itself when
   * the user picks an account — no password or credential id comes back here.
   */
  showChooser(anchor: { x: number; y: number }, scopeId: string): Promise<boolean>
  /** Password-free options for the active scoped login form. */
  listFillOptions(scopeId: string): Promise<BrowserCredentialMetadata[]>
  /**
   * Fill one option from the latest scoped list. Requires a live user gesture;
   * the password stays in the shell and resolves only whether a fill occurred.
   */
  fill(id: string, scopeId: string): Promise<boolean>
  /** Subscribe to whether the active tab can be filled. Replays the latest scoped value. */
  onFillAvailability(
    callback: (state: BrowserFillAvailability) => void,
    scopeId: string
  ): () => void
}

export interface LocalFilesystemMount {
  id: string
  name: string
  uri: string
  /** True when the encrypted grant will be restored after restarting the desktop app. */
  remembered: boolean
}

export type LocalFilesystemEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface LocalFilesystemEntry {
  name: string
  uri: string
  kind: LocalFilesystemEntryKind
  size?: number
  modifiedAt?: string
}

export interface LocalFilesystemStat {
  name: string
  uri: string
  kind: LocalFilesystemEntryKind
  size: number
  modifiedAt: string
}

export interface LocalFilesystemReadResult {
  uri: string
  content: string
  startLine: number
  endLine: number
  totalLines: number
}

export interface LocalFilesystemGrepMatch {
  uri: string
  line: number
  text: string
}

export type LocalFilesystemRequest =
  | { operation: 'mount_directory' }
  | { operation: 'list_mounts' }
  | { operation: 'forget_mount'; uri: string }
  | { operation: 'reveal_mount'; uri: string }
  | { operation: 'list'; uri: string; requestId?: string }
  | {
      operation: 'glob'
      uri: string
      pattern: string
      pathPrefix?: string
      requestId?: string
    }
  | {
      operation: 'read'
      uri: string
      startLine?: number
      lineCount?: number
      requestId?: string
    }
  | {
      operation: 'grep'
      uri: string
      query?: string
      pattern?: string
      include?: string
      caseSensitive?: boolean
      maxResults?: number
      outputMode?: 'content' | 'files_with_matches' | 'count'
      lineNumbers?: boolean
      context?: number
      requestId?: string
    }
  | { operation: 'stat'; uri: string; requestId?: string }
  | { operation: 'cancel'; requestId: string }

export type LocalFilesystemData =
  | { mount: LocalFilesystemMount | null; cancelled: boolean }
  | { mounts: LocalFilesystemMount[] }
  | { forgotten: boolean }
  | { revealed: boolean }
  | { entries: LocalFilesystemEntry[]; truncated: boolean }
  | { matches: LocalFilesystemGrepMatch[]; truncated: boolean }
  | { files: string[]; truncated: boolean }
  | { counts: Array<{ uri: string; count: number }>; truncated: boolean }
  | { cancelled: boolean }
  | LocalFilesystemReadResult
  | LocalFilesystemStat

export type LocalFilesystemResponse =
  | { ok: true; data: LocalFilesystemData }
  | {
      ok: false
      code:
        | 'INVALID_REQUEST'
        | 'INVALID_URI'
        | 'MOUNT_NOT_FOUND'
        | 'NOT_FOUND'
        | 'NOT_A_FILE'
        | 'NOT_A_DIRECTORY'
        | 'FILE_TOO_LARGE'
        | 'BINARY_FILE'
        | 'ACCESS_DENIED'
        | 'CANCELLED'
        | 'IO_ERROR'
      error: string
    }

/** Outcome of an OAuth connect handoff, pushed when the browser flow finishes. */
export interface DesktopOAuthConnectResult {
  ok: boolean
  /** OAuth error slug forwarded from the provider callback, when the flow failed. */
  error?: string
  /**
   * Chat attempt correlated by the desktop handoff, or null for a non-chat
   * connect. Absent only on older desktop shells that predate correlation.
   */
  chatAttemptId?: string | null
}

/**
 * Optional scope for an OAuth connect handoff. Chip-initiated connects carry
 * the workspace (the browser flow creates the workspace connect draft
 * server-side) and, for reconnects, the credential to rebind. Modal-initiated
 * connects carry the exact draft the app already created.
 */
export interface DesktopOAuthConnectScope {
  workspaceId?: string
  credentialId?: string
  draftId?: string
  /** Mothership credential-chip attempt to echo on desktop completion. */
  chatAttemptId?: string
}

export interface TerminalThemePalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  selectionBackground: string
  selectionForeground?: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export const TERMINAL_THEME_ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies readonly (keyof TerminalThemePalette)[]

export const TERMINAL_LIGHT_THEME = {
  background: '#fefefe',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#b4d5fe',
  black: '#24292e',
  red: '#d1242f',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
} as const satisfies TerminalThemePalette

export const TERMINAL_DARK_THEME = {
  background: '#1b1b1b',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
} as const satisfies TerminalThemePalette

export type TerminalThemeSource = 'terminal' | 'iterm2'

export interface TerminalSelectedProfile {
  /** Stable source profile id used to restore this selection. */
  id: string
  name: string
  source: TerminalThemeSource
  /**
   * Palette used when the source does not provide appearance-specific colors.
   * Ignored once both `lightPalette` and `darkPalette` are present.
   */
  palette: TerminalThemePalette
  /** Optional palette used while Sim is in light appearance. */
  lightPalette?: TerminalThemePalette
  /** Optional palette used while Sim is in dark appearance. */
  darkPalette?: TerminalThemePalette
}

export type TerminalThemeProfile = TerminalSelectedProfile

const TERMINAL_THEME_PALETTE_KEYS: readonly (keyof TerminalThemePalette)[] = [
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  ...TERMINAL_THEME_ANSI_KEYS,
]

const TERMINAL_THEME_OPTIONAL_PALETTE_KEYS = ['cursorAccent', 'selectionForeground'] as const

const TERMINAL_THEME_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function isTerminalThemeColor(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_THEME_COLOR_PATTERN.test(value)
}

function isTerminalThemePalette(value: unknown): value is TerminalThemePalette {
  if (typeof value !== 'object' || value === null) return false
  const palette = value as Partial<TerminalThemePalette>
  return (
    TERMINAL_THEME_PALETTE_KEYS.every((key) => isTerminalThemeColor(palette[key])) &&
    TERMINAL_THEME_OPTIONAL_PALETTE_KEYS.every(
      (key) => palette[key] === undefined || isTerminalThemeColor(palette[key])
    )
  )
}

export function isTerminalSelectedProfile(value: unknown): value is TerminalSelectedProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TerminalSelectedProfile>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    candidate.id.length <= 300 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    candidate.name.length <= 200 &&
    (candidate.source === 'terminal' || candidate.source === 'iterm2') &&
    isTerminalThemePalette(candidate.palette) &&
    (candidate.lightPalette === undefined || isTerminalThemePalette(candidate.lightPalette)) &&
    (candidate.darkPalette === undefined || isTerminalThemePalette(candidate.darkPalette))
  )
}

/**
 * Copies only the known profile fields, so untrusted source output and stored
 * config never carry extra keys. The single definition of a profile's shape —
 * new palette slots are added here rather than at each call site.
 */
export function cloneTerminalSelectedProfile(
  profile: TerminalSelectedProfile
): TerminalSelectedProfile {
  return {
    id: profile.id,
    name: profile.name,
    source: profile.source,
    palette: { ...profile.palette },
    ...(profile.lightPalette ? { lightPalette: { ...profile.lightPalette } } : {}),
    ...(profile.darkPalette ? { darkPalette: { ...profile.darkPalette } } : {}),
  }
}

export interface DesktopPreferences {
  notificationsEnabled: boolean
  notificationSounds: boolean
  notificationsOnlyWhenUnfocused: boolean
  launchAtLogin: boolean
  autoDownloadUpdates: boolean
  /** Show the Sim status item (recent chats menu) in the macOS menu bar. */
  trayEnabled: boolean
  /** Let Chat drive the built-in agent browser on this device. */
  browserEnabled: boolean
  /** Whether typing in the omnibox may request live Google search completions. */
  browserSearchSuggestionsEnabled?: boolean
  /** Let Chat run commands in local shells. */
  terminalEnabled: boolean
  /**
   * Appearance used by browser pages on this device. `app` follows Sim's
   * current preference; explicit values override it.
   */
  browserTheme: DesktopAppearanceTheme
  /** Default page zoom used by current and future built-in browser tabs. */
  browserDefaultZoom: DesktopZoomPercent
  /** Folder where the built-in browser saves downloads on this device. */
  browserDownloadDirectory: string
  /** Appearance used by terminal canvases on this device. */
  terminalTheme: TerminalAppearanceTheme
  /** Default canvas zoom used by current and future built-in terminal tabs. */
  terminalDefaultZoom: DesktopZoomPercent
}

export const DESKTOP_ZOOM_PERCENTS = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const

export type DesktopZoomPercent = (typeof DESKTOP_ZOOM_PERCENTS)[number]

export function isDesktopZoomPercent(value: unknown): value is DesktopZoomPercent {
  return typeof value === 'number' && (DESKTOP_ZOOM_PERCENTS as readonly number[]).includes(value)
}

export type DesktopZoomAction = 'in' | 'out' | 'reset'

export type TerminalShortcutCommand = 'clear' | `zoom-${DesktopZoomAction}`

const DESKTOP_ZOOM_STEP_RATIO = 1.1

/**
 * Resolves a focus-routed zoom command on any numeric scale. Browser pages
 * pass Chromium factors, while terminals pass percentage scales; sharing the
 * ladder keeps their shortcuts consistent without coupling either surface to
 * the other's units.
 */
export function resolveDesktopZoom(
  current: number,
  action: DesktopZoomAction,
  defaultZoom: number,
  bounds: Readonly<{ min: number; max: number }>
): number {
  if (action === 'reset') return defaultZoom
  const base = Number.isFinite(current) && current > 0 ? current : defaultZoom
  const next = action === 'in' ? base * DESKTOP_ZOOM_STEP_RATIO : base / DESKTOP_ZOOM_STEP_RATIO
  return Math.min(bounds.max, Math.max(bounds.min, next))
}

export const DESKTOP_APPEARANCE_THEMES = ['app', 'light', 'dark'] as const

export type DesktopAppearanceTheme = (typeof DESKTOP_APPEARANCE_THEMES)[number]

export function isDesktopAppearanceTheme(value: unknown): value is DesktopAppearanceTheme {
  return (
    typeof value === 'string' && (DESKTOP_APPEARANCE_THEMES as readonly string[]).includes(value)
  )
}

export type TerminalAppearanceTheme = DesktopAppearanceTheme | TerminalSelectedProfile

export function isTerminalAppearanceTheme(value: unknown): value is TerminalAppearanceTheme {
  return isDesktopAppearanceTheme(value) || isTerminalSelectedProfile(value)
}

/** Boolean preferences handled by the generic settings setter. */
export type DesktopPreferenceKey = {
  [K in keyof DesktopPreferences]-?: DesktopPreferences[K] extends boolean ? K : never
}[keyof DesktopPreferences]

export interface DesktopNotificationPayload {
  title: string
  body: string
  /** Optional in-app route opened when the notification is clicked. */
  route?: string
}

/** Device-level settings owned by the desktop shell. */
export interface SimDesktopSettingsApi {
  getPreferences(): Promise<DesktopPreferences>
  setPreference<K extends DesktopPreferenceKey>(
    key: K,
    value: DesktopPreferences[K]
  ): Promise<DesktopPreferences>
  /**
   * Controls whether partial omnibox queries may be sent to Google. Optional
   * for compatibility with installed shells that predate live suggestions.
   */
  setBrowserSearchSuggestionsEnabled?(enabled: boolean): Promise<DesktopPreferences>
  notify(payload: DesktopNotificationPayload): Promise<boolean>
  /** Overrides the appearance requested by browser pages. */
  setBrowserTheme(theme: DesktopAppearanceTheme): Promise<DesktopPreferences>
  /** Sets the default page zoom for current and future browser tabs. */
  setBrowserDefaultZoom(zoom: DesktopZoomPercent): Promise<DesktopPreferences>
  /** Shows a native folder picker and persists the selected browser download location. */
  chooseBrowserDownloadDirectory(): Promise<DesktopPreferences | null>
  /** Overrides the terminal canvas appearance. */
  setTerminalTheme(theme: DesktopAppearanceTheme): Promise<DesktopPreferences>
  /** Sets the default canvas zoom for current and future terminal tabs. */
  setTerminalDefaultZoom(zoom: DesktopZoomPercent): Promise<DesktopPreferences>
}

export interface SimDesktopTerminalThemesApi {
  listProfiles(): Promise<TerminalThemeProfile[]>
  selectProfile(profileId: string): Promise<DesktopPreferences | null>
}

/**
 * Where the shell's update pipeline currently is. `available` only occurs
 * when automatic downloads are disabled; with them enabled the shell moves
 * straight to `downloading`.
 */
export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  /** Version of the update being offered/downloaded/ready, when known. */
  version?: string
  /** Whole-number download progress (0-100) while `downloading`. */
  percent?: number
  /**
   * True when this shell cannot apply updates in place (a build without a
   * Developer ID signature — local installs and pre-signing CI prereleases;
   * Squirrel.Mac refuses to swap unsigned bundles). `available` is then the
   * pipeline's terminal state and the advance action opens the download in
   * the browser instead of downloading in the background.
   */
  manual?: boolean
}

/** The shell updater surface. */
export interface SimDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  /**
   * Advance the pipeline: checks for an update, or starts the download when
   * one is already known to be available (auto-download off).
   */
  check(): void
  /** Quit and install a `ready` update. No-op in any other state. */
  install(): void
  /** Subscribe to pipeline state changes. Returns an unsubscribe function. */
  onState(callback: (state: DesktopUpdateState) => void): () => void
}

export type DesktopCommand = 'toggle-sidebar' | 'open-search'

export interface DesktopWindowState {
  isFullScreen: boolean
}

export interface SimDesktopWindowStateApi {
  getState(): Promise<DesktopWindowState>
  onStateChange(callback: (state: DesktopWindowState) => void): () => void
}

/**
 * The Sim deployment an installed shell is pointed at. Self-hosted operators
 * install the same signed build everyone else does and repoint it here — the
 * bundle bakes only a DEFAULT origin, and every runtime guard (navigation,
 * CSP, cookie partition, update feed) is derived from the configured one.
 */
export interface DesktopServerConfiguration {
  /** The origin the shell is currently pointed at. */
  origin: string
  /** The origin this build falls back to when nothing is stored. */
  defaultOrigin: string
}

/** Outcome of a server change. On success the shell relaunches immediately. */
export type DesktopServerChangeResult =
  | { ok: true; origin: string; unchanged: boolean }
  | { ok: false; error: string }

/**
 * Reading and changing the server origin. Exposed only to the shell's own
 * bundled `file:` pages: the surface that changes which server the app talks
 * to must stay reachable when that server cannot be reached at all, and must
 * never be drivable by a page the current server serves.
 */
export interface SimDesktopServerApi {
  /** Opens the shell's native server-selection window. */
  open(): void
  getConfiguration(): Promise<DesktopServerConfiguration>
  /**
   * Validates and persists a new server origin, then relaunches the shell.
   * Resolves with an error message when the origin is rejected.
   */
  setOrigin(origin: string): Promise<DesktopServerChangeResult>
}

export interface SimDesktopApi {
  /** Installed shell version (plain semver, e.g. `0.3.1`). */
  version: string
  openExternal(url: string): Promise<boolean>
  /**
   * Start the OAuth connect handoff for a provider: the whole flow runs in
   * the system browser and returns via loopback. Resolves false when the
   * browser could not be opened.
   */
  beginOAuthConnect(providerId: string, scope?: DesktopOAuthConnectScope): Promise<boolean>
  /**
   * Subscribe to connect-handoff completions (the app is refocused just
   * before this fires). Returns an unsubscribe function.
   */
  onOAuthConnectComplete(callback: (result: DesktopOAuthConnectResult) => void): () => void
  offlineRetry(): void
  /**
   * Optional because shells older than this surface do not expose it. Only
   * the shell's own bundled pages can call it — see {@link SimDesktopServerApi}.
   */
  server?: SimDesktopServerApi
  localFilesystem(request: LocalFilesystemRequest): Promise<LocalFilesystemResponse>
  /** Subscribe to commands initiated by the native application menu. */
  onCommand(callback: (command: DesktopCommand) => void): () => void
  windowState: SimDesktopWindowStateApi
  settings: SimDesktopSettingsApi
  updates: SimDesktopUpdatesApi
  browserAgent: SimDesktopBrowserAgentApi
  /**
   * Local Chrome import for the built-in browser. Absent on platforms without
   * a supported importer.
   */
  browserImport?: SimDesktopBrowserImportApi
  /** Saved passwords and user-driven fill for the built-in browser. */
  browserCredentials: SimDesktopBrowserCredentialsApi
  terminal: SimDesktopTerminalApi
  /** Reads and selects Terminal.app or iTerm2 color profiles on macOS. */
  terminalThemes?: SimDesktopTerminalThemesApi
}
