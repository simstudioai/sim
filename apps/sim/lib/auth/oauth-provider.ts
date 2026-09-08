/**
 * Constants shared by every side of Sim's OAuth 2.0 provider: the Better Auth
 * plugin configuration, the consent page, the bearer-token verifier, and the
 * "Authorized apps" settings surface.
 */

/** The first-party Sim CLI, registered by the shared OAuth database lifecycle as a public client. */
export const SIM_CLI_CLIENT_ID = 'sim-cli'

/**
 * Prefixes returned on issued tokens (never stored). They make a leaked token
 * recognizable to secret scanners and to a human reading a log, the same way
 * `sim_` marks an API key.
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = 'sim_oat_'
export const OAUTH_REFRESH_TOKEN_PREFIX = 'sim_ort_'

/** Grants the Sim API: `api:write` implies `api:read`. */
export const OAUTH_API_READ_SCOPE = 'api:read'
export const OAUTH_API_WRITE_SCOPE = 'api:write'
export const OAUTH_SEARCH_READ_SCOPE = 'search:read'

export const OAUTH_SEARCH_SCOPES = [OAUTH_SEARCH_READ_SCOPE, 'offline_access'] as const
export const OAUTH_SCOPES = [
  'offline_access',
  OAUTH_API_READ_SCOPE,
  OAUTH_API_WRITE_SCOPE,
  OAUTH_SEARCH_READ_SCOPE,
] as const

export type OAuthScope = (typeof OAUTH_SCOPES)[number]

/**
 * RFC 6749 permits granting fewer scopes than requested. Some MCP clients request
 * every scope advertised by the shared issuer; a Search resource can only grant
 * Search access, and the returned scope always reports that narrower grant.
 */
export function narrowSearchOAuthScopes(scope: string): string | null {
  const requested = scope.split(' ').filter(Boolean)
  if (
    !requested.includes(OAUTH_SEARCH_READ_SCOPE) ||
    requested.some((value) => !OAUTH_SCOPES.some((allowed) => allowed === value))
  ) {
    return null
  }
  return OAUTH_SEARCH_SCOPES.filter((value) => requested.includes(value)).join(' ')
}

/**
 * Lifetimes in seconds. An hour bounds copied access tokens; refresh families
 * have a fixed thirty-day lifetime.
 */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
/** Bounds replay evidence for one login even if a client refreshes excessively. */
export const OAUTH_TOKEN_FAMILY_MAX_GENERATION = 1_000
/** How long an authorization code stays redeemable — the plugin's default. */
export const OAUTH_CODE_TTL_SECONDS = 10 * 60
export type OAuthApiScope =
  | typeof OAUTH_API_READ_SCOPE
  | typeof OAUTH_API_WRITE_SCOPE
  | typeof OAUTH_SEARCH_READ_SCOPE

/** One plain-English line per scope, rendered on the consent page. */
export const OAUTH_SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  offline_access: 'Stay signed in without asking again',
  [OAUTH_API_READ_SCOPE]: 'Read your workspaces, workflows, files, tables, and logs',
  [OAUTH_API_WRITE_SCOPE]: 'Read, create, change, run, and delete resources in your workspaces',
  [OAUTH_SEARCH_READ_SCOPE]: 'Search and read documents you can access in Sim Search',
}

/**
 * The scopes worth showing a person, in declaration order.
 *
 * `api:write` implies `api:read`, so a client that asked for both is granted
 * both — and listing them together reads as two permissions when it is one.
 * Dropping the implied scope keeps the consent page honest about how much it
 * is actually asking for.
 */
export function visibleOAuthScopes(granted: readonly string[]): OAuthScope[] {
  const implied = granted.includes(OAUTH_API_WRITE_SCOPE) ? OAUTH_API_READ_SCOPE : null
  return OAUTH_SCOPES.filter(
    (scope) =>
      scope !== implied &&
      !(scope === OAUTH_SEARCH_READ_SCOPE && oauthScopeSatisfies(granted, OAUTH_API_READ_SCOPE)) &&
      granted.includes(scope)
  )
}

/** What a grant lets an app reach, as one line for a settings row. */
export function summarizeOAuthAccess(granted: readonly string[]): string {
  if (granted.includes(OAUTH_API_WRITE_SCOPE)) return 'Full access to your workspaces'
  if (granted.includes(OAUTH_API_READ_SCOPE)) return 'Read-only access to your workspaces'
  if (granted.includes(OAUTH_SEARCH_READ_SCOPE)) return 'Read-only access to Sim Search'
  return 'No API access'
}

/**
 * Whether a granted scope set satisfies a required API scope. `api:write` is a
 * superset of `api:read`, so a write-capable token never has to also carry the
 * read scope explicitly.
 */
export function oauthScopeSatisfies(granted: readonly string[], required: OAuthApiScope): boolean {
  if (granted.includes(required)) return true
  if (required === OAUTH_SEARCH_READ_SCOPE) {
    return granted.includes(OAUTH_API_READ_SCOPE) || granted.includes(OAUTH_API_WRITE_SCOPE)
  }
  return required === OAUTH_API_READ_SCOPE && granted.includes(OAUTH_API_WRITE_SCOPE)
}

/**
 * Whether a consent request names the client given, read from the signed
 * authorize query the consent page forwards.
 *
 * Every occurrence is checked, not just the first. The plugin reads the same
 * query with `.get()`, so on a well-formed request the two always agree; on a
 * query carrying `client_id` twice this answers true where `.get()` would not,
 * which errs toward running the gate rather than skipping it.
 */
export function consentRequestNamesClient(oauthQuery: unknown, clientId: string): boolean {
  if (typeof oauthQuery !== 'string') return false
  return new URLSearchParams(oauthQuery).getAll('client_id').includes(clientId)
}
