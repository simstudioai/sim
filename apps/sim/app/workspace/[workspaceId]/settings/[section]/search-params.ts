import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the settings section pages.
 * The client hook consumes this typed param definition as the single source of
 * truth.
 *
 * `mcpServerId` deep-links the MCP settings tab to a specific server so the row
 * can be focused/opened from a shared link.
 */
export const mcpServerIdParam = {
  key: 'mcpServerId',
  parser: parseAsString,
} as const

/** Opening a server is a destination → push to history; clear on close. */
export const mcpServerIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * `fork-action` deep-links the Forks settings tab straight into a flow (currently
 * only `sync`, used by the workspace context menu's "Sync workspace" entry).
 * Read-then-strip: consumed once after the page's gate settles, then cleared.
 */
export const forkActionParam = {
  key: 'fork-action',
  parser: parseAsStringLiteral(['sync'] as const),
} as const

/**
 * `fork-id` deep-links the Forks settings tab to a specific fork's detail
 * sub-view (mirrors `mcpServerId` on the MCP tab).
 */
export const forkIdParam = {
  key: 'fork-id',
  parser: parseAsString,
} as const

/** Opening a fork's detail is a destination → push to history; clear on close. */
export const forkIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
