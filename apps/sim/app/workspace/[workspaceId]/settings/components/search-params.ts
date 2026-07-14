import { parseAsString } from 'nuqs/server'

/**
 * Shared URL query-param definition for the settings list search boxes
 * (teammates, api-keys, copilot, custom-tools, mcp, secrets,
 * workflow-mcp-servers). Settings sections never co-render, so they all share
 * the `search` key without collisions.
 *
 * The input is controlled directly by the nuqs value; only its URL write is
 * debounced via `limitUrlUpdates` at the hook options.
 */
export const settingsSearchParam = {
  key: 'search',
  parser: parseAsString.withDefault(''),
} as const

/** Search view-state: clean URLs, no back-stack churn. */
export const settingsSearchUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
