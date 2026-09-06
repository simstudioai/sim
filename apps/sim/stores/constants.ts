const API_ENDPOINTS = {
  ENVIRONMENT: '/api/environment',
  SETTINGS: '/api/users/me/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
  WORKSPACE_ENVIRONMENT: (id: string) => `/api/workspaces/${id}/environment`,
  WORKSPACE_BYOK_KEYS: (id: string) => `/api/workspaces/${id}/byok-keys`,
}

/**
 * Layout dimension constants.
 *
 * These values must stay in sync with:
 * - `globals.css` (CSS variable defaults)
 * - `layout.tsx` (blocking script validations)
 *
 * @see globals.css for CSS variable definitions
 * @see layout.tsx for pre-hydration script that reads localStorage
 */

/**
 * Inset in pixels between the viewport edge and the content window. Zero: the
 * pane sits flush against the viewport and meets the sidebar on a hairline
 * divider. Kept as a named constant because the panel, terminal, and floating
 * window geometry all measure from it.
 */
export const CONTENT_WINDOW_GAP = 0

/** Sidebar width constraints */
export const SIDEBAR_WIDTH = {
  DEFAULT: 256,
  MIN: 256,
  /** Width when sidebar is collapsed to icon-only mode */
  COLLAPSED: 48,
  /**
   * Absolute ceiling on the expanded width. The percentage below already scales
   * the rail with the viewport; this keeps a wide monitor from granting a rail
   * that swallows a third of the page. `getMaxSidebarWidth` combines the two.
   */
  MAX: 400,
  /** Maximum is 30% of viewport (up to `MAX`), enforced dynamically */
  MAX_PERCENTAGE: 0.3,
} as const

/** Right panel width constraints */
export const PANEL_WIDTH = {
  DEFAULT: 320,
  MIN: 290,
  /** Maximum is 40% of viewport, enforced dynamically */
  MAX_PERCENTAGE: 0.4,
} as const

/** Terminal height constraints */
export const TERMINAL_HEIGHT = {
  DEFAULT: 206,
  MIN: 30,
  /** Maximum is 70% of viewport, enforced dynamically */
  MAX_PERCENTAGE: 0.7,
} as const

/** Editor connections section height constraints */
export const EDITOR_CONNECTIONS_HEIGHT = {
  DEFAULT: 172,
  MIN: 30,
  MAX: 300,
} as const

/** Output panel (terminal execution results) width constraints */
export const OUTPUT_PANEL_WIDTH = {
  DEFAULT: 560,
  MIN: 280,
} as const

/** Home chat resource panel (MothershipView) width constraints */
export const MOTHERSHIP_WIDTH = {
  MIN: 280,
  /** Maximum is 80% of viewport, enforced dynamically. */
  MAX_PERCENTAGE: 0.8,
  /**
   * Narrowest the chat column beside the panel may be laid out at — the
   * `min-w-[240px]` class on that column in home.tsx, so the two must agree.
   *
   * The panel is what yields to it: the chat's flex-basis is 0, so the whole of
   * any negative free space is taken out of the panel. A width written past
   * `container - CHAT_MIN` therefore renders clamped while the inline style
   * still reads what was asked for, and anything deriving the divider from that
   * value follows an edge that is not on screen.
   */
  CHAT_MIN: 240,
  /**
   * Share of the viewport the panel takes while unpinned — the `w-1/2` class in
   * mothership-view. Also reported to the desktop shell so it can re-derive the
   * panel rect mid-resize, so the two must agree.
   */
  DEFAULT_RATIO: 0.5,
} as const

/** Terminal block column width - minimum width for the logs column */
export const TERMINAL_BLOCK_COLUMN_WIDTH = 240 as const
