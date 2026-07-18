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

const BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(BROWSER_TOOL_NAMES)

export function isBrowserToolName(name: string): name is BrowserToolName {
  return BROWSER_TOOL_NAME_SET.has(name)
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
 * Browser-chrome commands from the panel header (URL bar, back/forward,
 * reload). Page interactions need no protocol — the user acts on the real
 * embedded page directly.
 */
export interface BrowserPanelAction {
  action: 'navigate' | 'reload' | 'back' | 'forward'
  /** Absolute URL for `navigate` (typed into the panel's URL bar). */
  url?: string
}

/** Live state of the active page, pushed to the panel header. */
export interface BrowserPageState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * One interactive element from a `browser_snapshot`, identified by the
 * numeric id the model passes back to browser_click / browser_type / etc.
 */
export interface SnapshotElement {
  id: number
  role: string
  name: string
  value?: string
  href?: string
  disabled?: boolean
  checked?: boolean
}

export interface SnapshotResult {
  url: string
  title: string
  /**
   * Structural outline of the page: headings and landmarks interleaved with
   * interactive elements, each interactive line carrying its [ref=N] id.
   */
  outline: string
  /** True when the element list was cut off at the collection cap. */
  truncated: boolean
  scrollY: number
  pageHeight: number
  viewportHeight: number
}

export interface BrowserTabInfo {
  tabId: string
  title: string
  url: string
  active: boolean
}
