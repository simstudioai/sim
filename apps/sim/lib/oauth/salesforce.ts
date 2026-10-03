/**
 * Shared Salesforce OAuth helpers for the two connector provider ids.
 *
 * Salesforce runs two authorization servers — `login.salesforce.com` for
 * production and Developer Edition orgs, `test.salesforce.com` for sandboxes —
 * and a user in one cannot authenticate against the other. Better Auth's
 * `genericOAuth` takes static endpoints, so each host is registered as its own
 * provider, and `OAUTH_PROVIDERS.salesforce.services.salesforce.additionalProviderIds`
 * maps the sandbox id back to the single Salesforce service.
 *
 * Every code path that special-cases Salesforce by provider id must go through
 * {@link isSalesforceOAuthProviderId} rather than comparing to `'salesforce'`,
 * or sandbox credentials silently lose the behaviour production ones get.
 *
 * Deliberately free of imports so both the Better Auth config and API route
 * handlers can use it without dragging in the OAuth provider registry.
 */

/** The provider id a Salesforce connection defaults to. */
export const SALESFORCE_PRIMARY_PROVIDER_ID = 'salesforce'

/**
 * Every Salesforce authorization server, keyed by connector provider id. The
 * single source for the connector registrations, the refresh endpoints, the
 * `additionalProviderIds` that map them all onto one service, and the connect
 * modal's environment picker — adding a host here reaches all four.
 */
const SALESFORCE_AUTH_SERVERS: Readonly<Record<string, { loginHost: string; label: string }>> = {
  [SALESFORCE_PRIMARY_PROVIDER_ID]: {
    loginHost: 'login.salesforce.com',
    label: 'Production or Developer Edition',
  },
  'salesforce-sandbox': {
    loginHost: 'test.salesforce.com',
    label: 'Sandbox',
  },
}

/** Login host per Salesforce connector provider id. */
export const SALESFORCE_LOGIN_HOSTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SALESFORCE_AUTH_SERVERS).map(([providerId, server]) => [
    providerId,
    server.loginHost,
  ])
)

/** Non-default Salesforce provider ids, for the service's `additionalProviderIds`. */
export const SALESFORCE_ADDITIONAL_PROVIDER_IDS: readonly string[] = Object.keys(
  SALESFORCE_AUTH_SERVERS
).filter((providerId) => providerId !== SALESFORCE_PRIMARY_PROVIDER_ID)

/** Environment-picker labels, for the service's `providerIdLabels`. */
export const SALESFORCE_PROVIDER_ID_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SALESFORCE_AUTH_SERVERS).map(([providerId, server]) => [providerId, server.label])
)

/** Whether a stored credential's `providerId` is one of the Salesforce OAuth connectors. */
export function isSalesforceOAuthProviderId(providerId: string | null | undefined): boolean {
  return typeof providerId === 'string' && providerId in SALESFORCE_LOGIN_HOSTS
}

/**
 * Prefix under which the org's API instance URL is smuggled into Better Auth's
 * `scope` column. The token response carries no `instance_url`, and the account
 * row has nowhere else to put a provider-specific value.
 */
const SALESFORCE_INSTANCE_SCOPE_PREFIX = '__sf_instance__:'

const SALESFORCE_INSTANCE_URL_REGEX = new RegExp(`^${SALESFORCE_INSTANCE_SCOPE_PREFIX}([^\\s]+)`)

/** Value to store in `scope` so {@link extractSalesforceInstanceUrl} can read it back. */
export function withSalesforceInstanceScope(
  instanceUrl: string,
  scope: string | null | undefined
): string {
  return `${SALESFORCE_INSTANCE_SCOPE_PREFIX}${instanceUrl} ${scope ?? ''}`
}

/** Reads back the instance URL stored by {@link withSalesforceInstanceScope}. */
export function extractSalesforceInstanceUrl(scope: string | null | undefined): string | undefined {
  return scope?.match(SALESFORCE_INSTANCE_URL_REGEX)?.[1]
}

/**
 * Origins that are an authorization server rather than an org's API host. A
 * token minted at either can carry one in its `sub` claim, and calling
 * `/services/data/...` against a login host always fails — so neither is ever a
 * usable instance URL.
 */
const SALESFORCE_LOGIN_ORIGINS: ReadonlySet<string> = new Set(
  Object.values(SALESFORCE_LOGIN_HOSTS).map((host) => `https://${host}`)
)

export function isSalesforceLoginOrigin(origin: string): boolean {
  return SALESFORCE_LOGIN_ORIGINS.has(origin)
}
