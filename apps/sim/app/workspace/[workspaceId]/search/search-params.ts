import { parseAsString } from 'nuqs/server'

/**
 * `search` filters the Sim Search connector list by name and description. The
 * input is controlled directly by the instant nuqs value; only its URL write is
 * debounced via `useDebouncedSearchSetter` — never written on every keystroke.
 */
export const connectorSearchParam = {
  key: 'search',
  parser: parseAsString.withDefault(''),
} as const

/** Search is filter view-state: clean URLs, no back-stack churn. */
export const connectorSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
