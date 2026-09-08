import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * Read once for display; the auth client forwards the original signed query.
 * Nullable parsers preserve missing identifiers for rejection.
 */
const oauthConsentParsers = {
  client_id: parseAsString,
  scope: parseAsString,
  redirect_uri: parseAsString,
} as const

export const oauthConsentSearchParamsCache = createSearchParamsCache(oauthConsentParsers)
