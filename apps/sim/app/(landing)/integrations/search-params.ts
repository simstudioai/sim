import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the public integrations
 * directory. Both the client (`IntegrationGrid`) and any server component that
 * reads these params consume this single source of truth.
 *
 * - `search` is the directory search term, written debounced from the local
 *   input (logs pattern) — never on every keystroke.
 * - `category` is the active integration-type filter. Categories are derived
 *   from the data set, so a plain string is used; the empty default (no filter)
 *   clears from the URL.
 */
export const integrationsDirectoryParsers = {
  search: parseAsString.withDefault(''),
  category: parseAsString.withDefault(''),
} as const

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const integrationsDirectoryUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
