import { parseAsString } from 'nuqs/server'

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
