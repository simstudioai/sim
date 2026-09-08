import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

const SEARCH_SETUP_SOURCES = [
  'confluence',
  'github',
  'gitlab',
  'gmail',
  'google_calendar',
  'google_drive',
  'jira',
  'slack',
] as const

/** Null closes setup; an empty value opens the picker, and a source type resumes its form. */
export const searchSetupParam = {
  key: 'addConnector',
  parser: parseAsStringLiteral(['', ...SEARCH_SETUP_SOURCES]),
} as const

/** Null closes the source management panel. */
export const managedSourceParam = {
  key: 'manage-source',
  parser: parseAsString,
} as const

/** A setup detour carries intent, never an arbitrary redirect URL. */
export const searchSetupReturnParam = {
  key: 'search-setup',
  parser: parseAsStringLiteral([...SEARCH_SETUP_SOURCES, 'search']),
} as const

export type SearchSetupSource = NonNullable<ReturnType<typeof searchSetupParam.parser.parse>>

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

export type SearchSetupReturnSource = NonNullable<
  ReturnType<typeof searchSetupReturnParam.parser.parse>
>
