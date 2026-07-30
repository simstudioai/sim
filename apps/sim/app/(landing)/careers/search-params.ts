import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Sentinel value for an inactive filter — matches every posting. Namespaced with
 * underscores so it can never collide with a real Ashby department or location
 * value (e.g. a team literally named "all").
 */
export const ALL_FILTER_VALUE = '__all__'

/**
 * Co-located, typed URL query params for the careers job board's Team and
 * Location filters. Shareable, deep-linkable view-state over an already-rendered
 * list, so it lives in the URL (nuqs) — never in a store. The values are dynamic
 * (departments/locations come from the live board), so plain string parsers with
 * an `all` sentinel default rather than a fixed literal set.
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

/**
 * Server-side reader for the same parser map. The page parses the request's
 * query with this so the statically-rendered fallback is filtered to match a
 * deep-linked `?team=`/`?location=` URL — the roles never flash unfiltered before
 * the client board hydrates.
 */
export const careersSearchParamsCache = createSearchParamsCache(careersParsers)
