import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from 'nuqs/server'

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
 */
export const cliAuthParsers = {
  request: parseAsString,
  challenge: parseAsString,
  pairing: parseAsString,
  scope: parseAsStringLiteral(CLI_AUTH_SCOPES).withDefault('copilot'),
  workspace: parseAsString,
} as const

/**
 * Server-side reader for the same parser map, so `page.tsx` decides on the
 * login bounce from exactly the values the client component will re-read.
 */
export const cliAuthSearchParamsCache = createSearchParamsCache(cliAuthParsers)
