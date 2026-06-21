import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the public model directory.
 * Both the client (`ModelDirectory`) and any server component that reads these
 * params consume this single source of truth.
 *
 * - `search` is the directory search term, written debounced from the local
 *   input (logs pattern) — never on every keystroke.
 * - `provider` is the active provider filter. Provider ids are derived from the
 *   data set, so a plain string is used; the empty default (no filter) clears
 *   from the URL.
 */
export const modelDirectoryParsers = {
  search: parseAsString.withDefault(''),
  provider: parseAsString.withDefault(''),
} as const

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const modelDirectoryUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
