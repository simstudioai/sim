import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/**
 * `group-id` deep-links the Access Control settings tab to a specific
 * permission group's detail sub-view (mirrors `mcpServerId` on the MCP tab).
 */
export const groupIdParam = {
  key: 'group-id',
  parser: parseAsString,
} as const

/** Opening a group's detail is a destination → push to history; clear on close. */
export const groupIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * `group-tab` is the active tab inside the deep-linked permission-group detail
 * view, so a shared `group-id` link can land on the same tab (mirrors
 * `server-tab` on the workflow MCP server detail).
 */
export const groupTabParam = {
  key: 'group-tab',
  parser: parseAsStringLiteral(['general', 'providers', 'blocks', 'platform'] as const).withDefault(
    'general'
  ),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const groupTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-search` is the search box inside the permission-group detail view. The
 * provider/block/platform tabs never render together, so they share one param
 * rather than carrying three mutually-exclusive keys; the tab handler clears it
 * so a query cannot bleed across tabs. Distinct from the list's shared
 * `?search=` (`useSettingsSearch`), which belongs to the group list behind it.
 */
export const groupSearchParam = {
  key: 'group-search',
  parser: parseAsString.withDefault(''),
} as const

/** Search view-state: clean URLs, no back-stack churn. */
export const groupSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-status` filters the permission-group detail's toggle lists by enabled
 * state. Shared across the tabs for the same reason as `group-search`.
 */
export const groupStatusParam = {
  key: 'group-status',
  parser: parseAsStringLiteral([
    'all',
    'enabled',
    'disabled',
    'requestable',
    'unavailable',
  ] as const).withDefault('all'),
} as const

/** Filter view-state: clean URLs, no back-stack churn. */
export const groupStatusUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
