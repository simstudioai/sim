import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the Teammates view.
 *
 * `search` is the name/email filter. The input is controlled directly by the
 * nuqs value; only its URL write is debounced via `limitUrlUpdates`.
 */
export const teammatesSearchParam = {
  key: 'search',
  parser: parseAsString.withDefault(''),
} as const

/** Search view-state: clean URLs, no back-stack churn. */
export const teammatesUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
