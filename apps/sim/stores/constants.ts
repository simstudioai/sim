export const API_ENDPOINTS = {
  ENVIRONMENT: '/api/environment',
  SETTINGS: '/api/settings',
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

/** Sidebar width constraints */
export const SIDEBAR_WIDTH = {
  DEFAULT: 232,
  MIN: 232,
  /** Maximum is 30% of viewport, enforced dynamically */
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

/** Toolbar triggers section height constraints */
export const TOOLBAR_TRIGGERS_HEIGHT = {
  DEFAULT: 300,
  MIN: 30,
  MAX: 800,
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

/** Terminal block column width - minimum width for the logs column */
export const TERMINAL_BLOCK_COLUMN_WIDTH = 240 as const
