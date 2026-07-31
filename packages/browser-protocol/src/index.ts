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
