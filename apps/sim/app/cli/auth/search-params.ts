import {
  createSearchParamsCache,
  createSerializer,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server'

/** Key spaces the handoff can mint from. Mirrors `cliAuthScopeSchema`. */
export const CLI_AUTH_SCOPES = ['copilot', 'platform'] as const

/**
 * Co-located, typed URL query params for the CLI key handoff. Read-only for the
 * life of the page, so there is no `urlKeys` companion.
 *
 * `request`/`challenge`/`pairing` are nullable with no defaults: a missing value
 * is an invalid request, not a state to fall back from. `resolveCliAuthRequest`
 * validates them; never trusted as-is.
 *
 * `scope` defaults to `copilot` so a terminal built against the original handoff
 * — which sent no scope — still lands on the key space it expects. `workspace`
 * is only a preselection hint for the picker; the workspace that ends up bound
 * to the key is the one the user confirms, and it is re-authorized server-side.
 *
 * `access` and `expires` (whole days) are what the terminal asked the platform
 * key to be. Absent means a full-access key that never expires. Read as plain
 * strings so a malformed value is refused by `resolveCliAuthRequest` rather than
 * parsed to null and approved as the full-access, never-expiring default.
 */
export const cliAuthParsers = {
  request: parseAsString,
  challenge: parseAsString,
  pairing: parseAsString,
  scope: parseAsStringLiteral(CLI_AUTH_SCOPES).withDefault('copilot'),
  workspace: parseAsString,
  access: parseAsString,
  expires: parseAsString,
} as const

/**
 * Server-side reader for the same parser map, so `page.tsx` decides on the
 * login bounce from exactly the values the client component will re-read.
 */
export const cliAuthSearchParamsCache = createSearchParamsCache(cliAuthParsers)

/**
 * Re-serializes the handoff for the signed-out login bounce. Only params the
 * page understands survive, and a value the terminal asked for — a read-only
 * key, say — is carried through rather than silently dropped on the way back.
 */
export const serializeCliAuthSearchParams = createSerializer(cliAuthParsers)
