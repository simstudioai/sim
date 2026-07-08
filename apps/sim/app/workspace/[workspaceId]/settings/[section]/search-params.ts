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

/**
 * `fork-view` deep-links the Forks settings tab to its workspace-scoped Activity
 * view (opened from the page header's "See activity" action).
 */
export const forkViewParam = {
  key: 'fork-view',
  parser: parseAsStringLiteral(['activity'] as const),
} as const

/** Opening the activity view is a destination → push to history; clear on close. */
export const forkViewUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * `fork-direction` is the sync direction (push/pull) on the parent fork's detail
 * page — shareable view state, so a copied link opens the same side of the sync.
 */
export const forkSyncDirectionParam = {
  key: 'fork-direction',
  parser: parseAsStringLiteral(['push', 'pull'] as const).withDefault('push'),
} as const

/** Toggling direction is in-place view state → replace history; clear at the push default. */
export const forkSyncDirectionUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
