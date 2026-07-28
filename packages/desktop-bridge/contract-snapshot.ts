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
  'browser_type',
  'browser_press_key',
  'browser_scroll',
  'browser_select_option',
  'browser_hover',
  'browser_request_takeover',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

/** Hard cap shared by the desktop browser session and its renderer chrome. */
export const MAX_BROWSER_TABS = 8

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

/** Last captured frame used while renderer overlays occlude the native view. */
export interface BrowserPanelSnapshot {
  dataUrl: string
  tabId: string
}

/**
 * Browser-chrome commands from the panel header (URL bar, back/forward,
 * reload) plus `takeover-done`, sent by the Done chip on the chat's
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
    | 'takeover-done'
  /** Absolute URL for `navigate` (typed into the panel's URL bar). */
  url?: string
  /** Stable tab id for `duplicate-tab`, `switch-tab`, and `close-tab`. */
  tabId?: string
}

/** Live state of the active page, pushed to the panel header. */
export interface BrowserPageState {
  /** Present on desktop versions with multi-tab UI support. */
  tabId?: string
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
   * False starts a fresh search and highlights every match; true steps to the
   * next/previous match of the search already running. Typing re-searches;
   * Enter steps.
   */
  findNext: boolean
  /** Direction for a `findNext` step. Ignored when starting a fresh search. */
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
  pinned?: boolean
}

/** Complete live tab list pushed by the desktop shell. */
export interface BrowserTabsState {
  tabs: BrowserTabState[]
  activeTabId: string | null
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

/**
 * The agent-terminal surface of the preload bridge. Real PTYs run in the
 * Electron main process; the renderer paints their bytes with xterm.js and
 * forwards keystrokes back. Several terminals can be open at once, each its own
 * shell, and the user and the agent share them — so working directory and
 * environment stay consistent between the two.
 */
/**
 * The agent-terminal surface of the preload bridge.
 *
 * Members added after this surface first shipped are `optional?`, matching the
 * browser-agent surface beside it and the "feature-detect, never assume" rule
 * in apps/desktop/README.md: one web app is served to shells of every age, and
 * `MIN_DESKTOP_VERSION` is still `0.0.0` (no floor), so an older shell reaches
 * this code. Declaring such a member required makes the type disagree with the
 * renderer, which has to `?.` it anyway — and the contract audit cannot catch
 * that, because it compares against a snapshot the same PR regenerates.
 */
export interface SimDesktopTerminalApi {
  /** Open the first terminal, or adopt the ones already running. */
  start(options: TerminalStartOptions): Promise<TerminalTabsState>
  /**
   * Execute one terminal operation. Resolves with the outcome; never rejects
   * for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<TerminalToolResponse>
  /** Forward the user's keystrokes to one terminal's PTY. */
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  /** Open an additional terminal and make it active. */
  openTerminal(cwd?: string): Promise<TerminalTabsState>
  switchTerminal(terminalId: string): Promise<TerminalTabsState>
  closeTerminal(terminalId: string): Promise<TerminalTabsState>
  getTabs?(): Promise<TerminalTabsState>
  /** End every shell. A new one starts on the next `start`. */
  dispose(): void
  /** Subscribe to PTY output batches. Returns an unsubscribe function. */
  onData?(callback: (terminalId: string, data: string) => void): () => void
  /**
   * Everything already on a terminal's screen, for a new view to paint itself
   * from. Pulled per view so the repaint cannot be aimed at the wrong set of
   * subscribers, or at none at all.
   */
  getScrollback(terminalId: string): Promise<string>
  /**
   * Reports whether the terminal panel owns keyboard focus, so global menu
   * accelerators can tell a Cmd-W meant for a terminal from one meant for the
   * window.
   */
  setFocused?(focused: boolean): void
  /**
   * The user finishing a handoff — the hand-back chip on the waiting tool row.
   */
  finishHandoff?(terminalId: string): void
  /** Subscribe to the open-terminal list and which one is active. */
  onTabs?(callback: (state: TerminalTabsState) => void): () => void
  /** Subscribe to command start/end, used for agent attribution in the panel. */
  onCommand?(callback: (event: TerminalCommandEvent) => void): () => void
}

/**
 * The browser-agent surface of the preload bridge. Tools execute in the
 * Electron main process against the desktop app's built-in agent browser — a
 * persistent-profile browser view embedded in the main Sim window, positioned
 * over the chat's browser panel so the user interacts with the real page.
 */
export interface SimDesktopBrowserAgentApi {
  /**
   * Execute one browser tool. Resolves with the tool's outcome; never
   * rejects for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    tool: BrowserToolName,
    params: Record<string, unknown>
  ): Promise<BrowserToolResponse>
  /** Browser-chrome commands from the panel (URL bar, back, reload, takeover Done). */
  panelAction(action: BrowserPanelAction): void
  /**
   * Pin or unpin a live browser tab. Optional for compatibility with desktop
   * builds predating durable pinned tabs.
   */
  setTabPinned?(tabId: string, pinned: boolean): void
  /**
   * Move a live tab to a final list index. Optional for compatibility with
   * desktop builds predating tab reordering.
   */
  reorderTab?(tabId: string, targetIndex: number): void
  /**
   * Report where the browser panel sits in the window (CSS pixels relative
   * to the viewport), or null when the panel is hidden/unmounted. The main
   * process keeps the embedded view glued to this rect.
   *
   * `anchor` declares how that rect derives from the viewport so the shell can
   * re-evaluate it mid-resize rather than hold a stale rect; omit it and the
   * shell falls back to the measured rect alone. Shells predating it ignore the
   * argument.
   */
  setPanelBounds(bounds: BrowserPanelBounds | null, anchor?: BrowserPanelAnchor | null): void
  /**
   * Report whether renderer-owned browser chrome currently owns the user's
   * interaction context. Optional for compatibility with older desktop builds.
   */
  setPanelFocused?(focused: boolean): void
  /**
   * Hide or reveal the native browser surface without detaching it. Optional
   * so newer web deployments remain compatible with older desktop builds.
   */
  setPanelOccluded?(occluded: boolean): void
  /**
   * Mirror Sim's light/dark/system preference into the embedded pages.
   * Optional for compatibility with desktop builds predating theme sync.
   */
  setTheme?(theme: BrowserTheme): void
  /**
   * Focus requests emitted by native tabs for browser-level keyboard
   * shortcuts such as Mod+L and Mod+T.
   */
  onFocusOmnibox?(callback: (mode: BrowserOmniboxFocusMode) => void): () => void
  /**
   * Run Chromium's find-in-page against the active tab. Results do not come
   * back from this call — they stream through {@link onFindResult}. Optional
   * for compatibility with desktop builds predating find-in-page.
   */
  find?(request: BrowserFindRequest): void
  /**
   * Stop the running find and clear its highlights. `focusPage` hands keyboard
   * focus back to the page, for the user dismissing the bar; omit it when the
   * bar is going away because the panel is.
   */
  stopFind?(focusPage?: boolean): void
  /**
   * Mod+F pressed while the embedded page had focus, which the renderer never
   * sees as a key event. Opening the find bar is the renderer's job either
   * way, so both entry paths land on the same handler.
   */
  onOpenFind?(callback: () => void): () => void
  /**
   * The shell dismissing the find bar — the active tab navigated away from the
   * document the find was run against, or the user switched tabs.
   */
  onCloseFind?(callback: () => void): () => void
  /** Match counts for the running find, as Chromium resolves them. */
  onFindResult?(callback: (result: BrowserFindResult) => void): () => void
  /**
   * Subscribe to captured browser frames used beneath renderer overlays.
   * Optional for compatibility with desktop builds predating occlusion.
   */
  onPanelSnapshot?(callback: (snapshot: BrowserPanelSnapshot) => void): () => void
  /** Subscribe to live page state for the panel header. Returns an unsubscribe function. */
  onPageState(callback: (state: BrowserPageState) => void): () => void
  /**
   * Read the current live tab list. Optional so a newer web deployment remains
   * compatible with installed desktop versions that only support one visible tab.
   */
  getTabsState?(): Promise<BrowserTabsState>
  /**
   * Read a privacy-preserving hint of websites that may have a usable session
   * in the dedicated profile. Optional for compatibility with older shells.
   */
  getKnownSessions?(): Promise<BrowserKnownSessionsState>
  /**
   * Erase browsing data from the dedicated profile and resolve the resulting
   * session list. Pass the kinds to clear; omit for all of them. Saved
   * passwords are never included — deleting those is a separate action.
   * Optional for compatibility with older shells, which ignore the argument
   * and clear everything.
   */
  clearBrowsingData?(kinds?: readonly BrowserDataKind[]): Promise<BrowserKnownSessionsState>
  /**
   * Subscribe to live tab-list changes. Optional for compatibility with older
   * installed desktop versions.
   */
  onTabsState?(callback: (state: BrowserTabsState) => void): () => void
  /**
   * Subscribe to session liveness changes (false when the browser session
   * ends). Returns an unsubscribe function.
   */
  onSessionStatus(callback: (alive: boolean) => void): () => void
}

/**
 * One browser profile found on this device.
 *
 * `id` is an opaque handle used to name the same profile back to the shell;
 * the shell resolves it against the profiles it discovered rather than
 * building a path from it. Host paths never cross this bridge.
 *
 * `browserId` and `browserLabel` are optional because shells that only
 * supported Chrome did not report them — treat their absence as Chrome.
 */
export interface BrowserImportProfile {
  id: string
  /** Browser and profile together, e.g. `Arc · Microtrades`. */
  label: string
  /** Stable browser identifier, e.g. `chrome`, `arc`, `brave`. */
  browserId?: string
  /** The browser's product name, e.g. `Arc`. */
  browserLabel?: string
  /** The profile on its own, e.g. `Microtrades` or `Default`. */
  profileLabel?: string
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
 * dedicated profile. macOS-only today, and optional in two senses: older
 * shells lack the surface entirely, and shells on platforms without a
 * supported importer omit it too — so always feature-detect before rendering.
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
   *
   * Optional — feature-detect before calling, so a newer web deployment keeps
   * working against an installed shell that predates it.
   */
  listSites?(): Promise<BrowserSiteInfo[]>
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
   * Optional: shells that predate saved passwords expose only
   * {@link importChromeCookies}, so feature-detect before offering it.
   */
  importFromChrome?(
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
 * Intentionally a bare boolean. The renderer learns nothing about which
 * accounts exist, and the chooser itself is a native main-process surface, so
 * no credential identifier crosses this bridge on the fill path at all.
 */
export interface BrowserFillAvailability {
  available: boolean
}

/**
 * The saved-password surface for the built-in browser: an OS-encrypted local
 * vault plus a user-driven fill.
 *
 * Optional so newer web deployments keep working against shells that lack it,
 * and absent where secure storage is unavailable — there is no plaintext
 * fallback. The agent has no path to any of it: management calls require the
 * Sim app origin, filling additionally requires a real user gesture and is
 * completed by a native menu the renderer cannot drive, and no browser tool
 * maps to these channels.
 */
export interface SimDesktopBrowserCredentialsApi {
  /** False when OS-backed encryption is unavailable and passwords are disabled. */
  isAvailable(): Promise<boolean>
  /** Saved credentials, without passwords. */
  list(): Promise<BrowserCredentialMetadata[]>
  /** Forget one credential; resolves the remaining list. */
  forget(id: string): Promise<BrowserCredentialMetadata[]>
  /**
   * Delete every saved password. Requires an active user gesture; resolves the
   * resulting (empty) list. Optional — feature-detect before offering it.
   */
  forgetAll?(): Promise<BrowserCredentialMetadata[]>
  /**
   * Reveal one saved password so the user can read it.
   *
   * This is the only method on the entire bridge that can produce password
   * plaintext, and it is heavily conditioned: it requires an active user
   * gesture, the shell prompts for Touch ID (or a native confirmation where
   * Touch ID is unavailable) on every call, and it returns exactly one
   * password. Resolves null when the user declines or the credential is gone.
   *
   * Optional — shells that predate the password manager omit it.
   */
  reveal?(id: string): Promise<string | null>
  /**
   * Copy one saved password to the clipboard. Same authorization as
   * {@link reveal}, but the password never enters the renderer: the shell
   * writes the clipboard itself and clears it again shortly after.
   */
  copy?(id: string): Promise<boolean>
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
  showChooser(anchor: { x: number; y: number }): Promise<boolean>
  /** Subscribe to whether the active tab can be filled. */
  onFillAvailability(callback: (state: BrowserFillAvailability) => void): () => void
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
}

/**
 * Optional scope for an OAuth connect handoff. Chip-initiated connects carry
 * the workspace (the browser flow creates the workspace connect draft
 * server-side) and, for reconnects, the credential to rebind. Modal-initiated
 * connects omit both — the app already created the draft.
 */
export interface DesktopOAuthConnectScope {
  workspaceId?: string
  credentialId?: string
}

export interface DesktopPreferences {
  notificationsEnabled: boolean
  notificationSounds: boolean
  notificationsOnlyWhenUnfocused: boolean
  launchAtLogin: boolean
  autoDownloadUpdates: boolean
  /**
   * Show the Sim status item (recent chats menu) in the macOS menu bar.
   * Optional because shells predating the preference don't report it.
   */
  trayEnabled?: boolean
  /**
   * Let Chat drive the built-in agent browser on this device. Optional
   * because shells predating the preference don't report it; absent means the
   * surface is simply always on, which is how those shells behave.
   */
  browserEnabled?: boolean
  /** Let Chat run commands in local shells. Same compatibility caveat. */
  terminalEnabled?: boolean
}

/**
 * The keys settable through {@link SimDesktopSettingsApi.setPreference}. A
 * closed union frozen at the first shell release: widening it would demand a
 * capability installed shells lack (their setPreference is typed over fewer
 * keys), which the bridge contract audit rejects. Preferences added later get
 * their own optional setter (e.g. {@link SimDesktopSettingsApi.setTrayEnabled})
 * so the web app can feature-detect them — and must be excluded here, or they
 * widen this union right back.
 */
export type DesktopPreferenceKey = Exclude<
  keyof DesktopPreferences,
  'trayEnabled' | 'browserEnabled' | 'terminalEnabled'
>

export interface DesktopNotificationPayload {
  title: string
  body: string
  /** Optional in-app route opened when the notification is clicked. */
  route?: string
}

/**
 * Device-level settings owned by the desktop shell. This surface is optional
 * so a newer web deployment remains compatible with older installed shells.
 */
export interface SimDesktopSettingsApi {
  getPreferences(): Promise<DesktopPreferences>
  setPreference<K extends DesktopPreferenceKey>(
    key: K,
    value: DesktopPreferences[K]
  ): Promise<DesktopPreferences>
  notify(payload: DesktopNotificationPayload): Promise<boolean>
  /**
   * Shows or hides the Sim menu-bar status item. Optional: only shells that
   * support the tray preference expose it — feature-detect before rendering
   * a toggle.
   */
  setTrayEnabled?(enabled: boolean): Promise<DesktopPreferences>
  /**
   * Turns the agent browser on or off for this device; disabling it also ends
   * the running session. Optional — feature-detect before rendering a toggle.
   */
  setBrowserEnabled?(enabled: boolean): Promise<DesktopPreferences>
  /**
   * Turns the agent terminal on or off for this device; disabling it also
   * ends every open shell. Optional, like {@link setBrowserEnabled}.
   */
  setTerminalEnabled?(enabled: boolean): Promise<DesktopPreferences>
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

/**
 * The shell updater surface. Optional so a newer web deployment remains
 * compatible with older installed shells.
 */
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

export type DesktopCommand = 'toggle-sidebar'

export interface DesktopWindowState {
  isFullScreen: boolean
}

export interface SimDesktopWindowStateApi {
  getState(): Promise<DesktopWindowState>
  onStateChange(callback: (state: DesktopWindowState) => void): () => void
}

export interface SimDesktopApi {
  /**
   * Installed shell version (plain semver, e.g. `0.3.1`). Optional because
   * shells predating version reporting don't set it — the web app's minimum
   * shell version gate treats an absent version as older than any floor.
   */
  version?: string
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
  localFilesystem(request: LocalFilesystemRequest): Promise<LocalFilesystemResponse>
  /** Subscribe to commands initiated by the native application menu. */
  onCommand?(callback: (command: DesktopCommand) => void): () => void
  windowState?: SimDesktopWindowStateApi
  settings?: SimDesktopSettingsApi
  updates?: SimDesktopUpdatesApi
  browserAgent?: SimDesktopBrowserAgentApi
  /**
   * Local Chrome import for the built-in browser. Absent on shells predating
   * it and on platforms without a supported importer.
   */
  browserImport?: SimDesktopBrowserImportApi
  /**
   * Saved passwords and user-driven fill for the built-in browser. Absent on
   * older shells and wherever OS-backed encryption is unavailable.
   */
  browserCredentials?: SimDesktopBrowserCredentialsApi
  /**
   * Optional so a newer web deployment stays compatible with installed shells
   * that predate the agent terminal.
   */
  terminal?: SimDesktopTerminalApi
}
