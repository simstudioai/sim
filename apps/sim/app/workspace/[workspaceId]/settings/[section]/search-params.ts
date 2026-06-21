import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the settings section pages.
 * Both the client (`SettingsPage`) and any server component that needs to read
 * these params consume this single source of truth.
 *
 * `mcpServerId` deep-links the MCP settings tab to a specific server so the row
 * can be focused/opened from a shared link.
 */
export const mcpServerIdParam = {
  key: 'mcpServerId',
  parser: parseAsString,
} as const
