import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * The authorize parameters the consent card renders. The rest of the signed
 * query (`state`, `sig`, `exp`, …) stays untouched in `window.location.search`,
 * which is what the auth client forwards verbatim on the consent call.
 *
 * Read-only for the life of the page, so there is no `urlKeys` companion and
 * no client-side `useQueryStates` — the server component reads them and passes
 * them down as props.
 *
 * Deliberately nullable rather than `.withDefault('')`: a missing `client_id`
 * is a malformed request the card must refuse, not a value to fall back on.
 */
const oauthConsentParsers = {
  client_id: parseAsString,
  scope: parseAsString,
  redirect_uri: parseAsString,
} as const

export const oauthConsentSearchParamsCache = createSearchParamsCache(oauthConsentParsers)
