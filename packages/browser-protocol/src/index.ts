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
 * input. Both sides consume this package for tool identity, shared timeout
 * policy, and bridge envelopes. Individual tool parameters and results are
 * still validated by the desktop driver rather than statically mapped here.
 *
 * Current tool names mirror the mothership tool catalog
 * (`copilot/internal/tools/catalog/browser` in the mothership repo). This
 * package also retains retired names needed to replay persisted chat history.
 * The catalog is the source of truth for what the model can call; this package
 * is the source of truth for how current and compatible legacy calls travel to
 * the desktop main process.
 */

export const CURRENT_BROWSER_TOOL_NAMES = [
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
] as const

export type CurrentBrowserToolName = (typeof CURRENT_BROWSER_TOOL_NAMES)[number]

export const RETIRED_BROWSER_TOOL_NAMES = ['browser_request_takeover'] as const

export const BROWSER_TOOL_NAMES = [
  ...CURRENT_BROWSER_TOOL_NAMES,
  ...RETIRED_BROWSER_TOOL_NAMES,
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export const BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS = 10_000
export const BROWSER_WAIT_FOR_MAX_TIMEOUT_MS = 120_000
export const BROWSER_WAIT_FOR_RENDERER_GRACE_MS = 15_000
export const BROWSER_TOOL_AUTHORIZATION_TIMEOUT_MS = 8_000
export const BROWSER_NAVIGATION_NATIVE_WATCHDOG_MS = 60_000
const BROWSER_RENDERER_TRANSPORT_GRACE_MS = 2_000
export const BROWSER_NAVIGATION_RENDERER_TIMEOUT_MS =
  BROWSER_TOOL_AUTHORIZATION_TIMEOUT_MS +
  BROWSER_NAVIGATION_NATIVE_WATCHDOG_MS +
  BROWSER_RENDERER_TRANSPORT_GRACE_MS

/**
 * Normalizes the model-visible `browser_wait_for.timeoutMs` consistently in
 * the renderer and desktop main process.
 */
export function normalizeBrowserWaitForTimeoutMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS
  return Math.min(parsed, BROWSER_WAIT_FOR_MAX_TIMEOUT_MS)
}

export const BROWSER_THEMES = ['system', 'light', 'dark'] as const

/** Sim appearance preference mirrored into browser-tab media queries. */
export type BrowserTheme = (typeof BROWSER_THEMES)[number]

/** How a native browser shortcut should focus Sim's renderer-owned omnibox. */
export type BrowserOmniboxFocusMode = 'select' | 'clear'

const BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(BROWSER_TOOL_NAMES)
const CURRENT_BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(CURRENT_BROWSER_TOOL_NAMES)
const BROWSER_THEME_SET: ReadonlySet<string> = new Set(BROWSER_THEMES)

export function isBrowserToolName(name: string): name is BrowserToolName {
  return BROWSER_TOOL_NAME_SET.has(name)
}

/** True only for browser tools the current model catalog may execute. */
export function isCurrentBrowserToolName(name: string): name is CurrentBrowserToolName {
  return CURRENT_BROWSER_TOOL_NAME_SET.has(name)
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
 * reload) plus the legacy `takeover-done` action retained for persisted
 * `browser_request_takeover` cards. Page interactions need no protocol — the
 * user acts on the real embedded page directly, and its right-click menu is
 * native and lives entirely in the shell.
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
    | 'respond-media-permission'
    | 'respond-site-permission'
    | 'takeover-done'
  /** Absolute URL for `navigate` (typed into the panel's URL bar). */
  url?: string
  /** Stable tab id for `duplicate-tab`, `switch-tab`, and `close-tab`. */
  tabId?: string
  /** Optional free-text instruction submitted with `takeover-done`. */
  takeoverResponse?: string
  /** Exact pending permission request being answered. */
  requestId?: string
  /** User decision for a permission response. */
  allowed?: boolean
}

export type BrowserMediaDevice = 'microphone' | 'camera'

/** One document-scoped media request awaiting an explicit user decision. */
export interface BrowserMediaPermissionRequest {
  requestId: string
  origin: string
  devices: BrowserMediaDevice[]
}

/** One ungranted top-level origin transition awaiting explicit user consent. */
export interface BrowserSitePermissionRequest {
  requestId: string
  /** Exact tab whose suspended request will be resumed or cancelled. */
  tabId: string
  /** Destination origin only; credentials, paths, query strings, and fragments are excluded. */
  origin: string
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
  /** Recoverable problem replacing the native page surface. Optional for older shells. */
  issue?: BrowserPageIssue
  /** Main-frame media request awaiting a renderer-owned permission prompt. */
  mediaPermissionRequest?: BrowserMediaPermissionRequest
  /** Ungranted top-level origin transition awaiting a renderer-owned permission prompt. */
  sitePermissionRequest?: BrowserSitePermissionRequest
}

/** A recoverable top-level page problem rendered by Sim instead of a blank native view. */
export type BrowserPageIssue =
  | {
      kind: 'load-error'
      /** Chromium network error number, such as -102 for connection refused. */
      code: number
      /** Chromium network error name, such as ERR_CONNECTION_REFUSED. */
      description: string
      /** The attempted URL, which may never have committed in WebContents. */
      url: string
    }
  | {
      kind: 'crashed'
      /** Chromium renderer exit reason, such as crashed or oom. */
      reason: string
      url: string
    }
  | {
      kind: 'unresponsive'
      url: string
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
  /** Recoverable problem currently replacing this tab's native page surface. */
  issue?: BrowserPageIssue
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
 * Downloads are deliberately absent because their files and per-chat transfer
 * history have a separate lifecycle from Chromium browsing-data removal.
 * Saved passwords are absent too — they are a separate, explicit action.
 */
export type BrowserDataKind = (typeof BROWSER_DATA_KINDS)[number]

const BROWSER_DATA_KIND_SET: ReadonlySet<string> = new Set(BROWSER_DATA_KINDS)

export function isBrowserDataKind(value: unknown): value is BrowserDataKind {
  return typeof value === 'string' && BROWSER_DATA_KIND_SET.has(value)
}
