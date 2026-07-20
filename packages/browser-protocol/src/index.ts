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
  'browser_go_back',
  'browser_go_forward',
  'browser_open_tab',
  'browser_switch_tab',
  'browser_close_tab',
  'browser_list_tabs',
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
export const MAX_BROWSER_TABS = 5

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
 * acts on the real embedded page directly.
 */
export interface BrowserPanelAction {
  action:
    | 'navigate'
    | 'reload'
    | 'back'
    | 'forward'
    | 'new-tab'
    | 'switch-tab'
    | 'close-tab'
    | 'takeover-done'
  /** Absolute URL for `navigate` (typed into the panel's URL bar). */
  url?: string
  /** Stable tab id for `switch-tab` and `close-tab`. */
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

/** Summary of one live page in the desktop agent browser. */
export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  loading: boolean
  active: boolean
}

/** Complete live tab list pushed by the desktop shell. */
export interface BrowserTabsState {
  tabs: BrowserTabState[]
  activeTabId: string | null
}
