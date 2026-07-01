import { parseAsString } from 'nuqs/server'

/** Sentinel value for an inactive filter — matches every posting. */
export const ALL_FILTER_VALUE = 'all'

/**
 * Co-located, typed URL query params for the careers job board's Team and
 * Location filters. Shareable, deep-linkable view-state over an already-rendered
 * list, so it lives in the URL (nuqs) — never in a store. The values are dynamic
 * (departments/locations come from the live board), so plain string parsers with
 * an `all` default rather than a fixed literal set. Imported by the client board
 * (`useQueryStates`); the page renders every posting statically and filters on
 * the client, so no server-side cache is needed.
 */
export const careersParsers = {
  team: parseAsString.withDefault(ALL_FILTER_VALUE),
  location: parseAsString.withDefault(ALL_FILTER_VALUE),
} as const

/** Clean URLs, no back-stack churn — the filters are a passive view switch. */
export const careersUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
