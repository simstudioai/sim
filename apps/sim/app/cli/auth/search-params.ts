import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query params for the CLI key handoff. Read-only for the
 * life of the page, so there is no `urlKeys` companion.
 *
 * Nullable with no defaults: a missing value is an invalid request, not a state
 * to fall back from. `resolveCliAuthRequest` validates them; never trusted as-is.
 */
export const cliAuthParsers = {
  callback: parseAsString,
  state: parseAsString,
  challenge: parseAsString,
  pairing: parseAsString,
} as const

/**
 * Server-side reader for the same parser map, so `page.tsx` decides on the
 * login bounce from exactly the values the client component will re-read.
 */
export const cliAuthSearchParamsCache = createSearchParamsCache(cliAuthParsers)
