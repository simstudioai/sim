/**
 * Zoho-owned apex domains across data centers. `apiDomain` and attachment `href`
 * values are user/LLM-influenced, so any outbound request that carries the OAuth
 * token - and the data-center base persisted at token exchange - must anchor its
 * host to one of these with a strict suffix match. A naive `contains "zoho."` or
 * `desk.zoho.*` check would accept an attacker domain like `zoho.attacker.com` or
 * `desk.zoho.com.attacker.com` and leak the token to it.
 *
 * Kept in its own dependency-free module so the auth token-exchange path can
 * validate hosts without pulling in the heavier tool utilities (e.g. html-to-text).
 */
const ZOHO_ALLOWED_APEX_DOMAINS = [
  'zoho.com',
  'zoho.eu',
  'zoho.in',
  'zoho.com.au',
  'zoho.jp',
  'zoho.ca',
  'zoho.sa',
  'zoho.com.cn',
  'zoho.uk',
  'zohoapis.com',
  'zohoapis.eu',
  'zohoapis.in',
  'zohoapis.com.au',
  'zohoapis.jp',
  'zohoapis.ca',
  'zohoapis.sa',
  'zohoapis.com.cn',
  'zohoapis.uk',
]

/** Zoho Desk REST host for the US data center, used whenever no data center is known. */
export const DEFAULT_ZOHO_DESK_BASE = 'https://desk.zoho.com'

/** True only when the hostname is exactly a Zoho apex or a subdomain of one. */
export function isZohoHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ZOHO_ALLOWED_APEX_DOMAINS.some((apex) => host === apex || host.endsWith(`.${apex}`))
}

/**
 * Derive the Zoho Desk REST base URL from a token response `api_domain`
 * (e.g. `https://www.zohoapis.eu` -> `https://desk.zoho.eu`). Zoho returns the
 * data-center-scoped `api_domain` on the `www.zohoapis.*` host, but the Desk
 * REST API lives on `desk.zoho.*` in the same data center. Deriving the Desk
 * base (instead of assuming `desk.zoho.com`) honors data residency.
 *
 * Shared by the OAuth token exchange, which persists the result on the
 * credential, and by the client-credentials service-account minter, which
 * returns it alongside the minted token - the two must not drift.
 *
 * @returns the derived Desk base, or `undefined` when `apiDomain` is absent,
 * unparseable, or not a Zoho host. Callers that must distinguish "Zoho told us
 * a data center" from "we fell back" use this instead of
 * {@link deriveZohoDeskBaseFromApiDomain}, so an untrusted `api_domain` can
 * never masquerade as an authoritative US answer.
 */
export function tryDeriveZohoDeskBaseFromApiDomain(apiDomain?: string): string | undefined {
  if (!apiDomain) return undefined
  try {
    const host = new URL(apiDomain).host.toLowerCase()
    // Gate on the strict Zoho apex allowlist before trusting the host: a loose
    // `desk.zoho.*` pattern would accept a lookalike like `desk.zoho.com.attacker.com`
    // and persist it as the credential's REST base, later leaking the OAuth token.
    if (!isZohoHost(host)) return undefined
    // Map the data-center TLD from the (now trusted) host onto the Desk REST host
    // in the same data center - works for both www.zohoapis.<tld> and desk.zoho.<tld>.
    const match = host.match(/zoho(?:apis)?\.([a-z.]+)$/)
    return match?.[1] ? `https://desk.zoho.${match[1]}` : undefined
  } catch {
    return undefined
  }
}

/**
 * Derive the Zoho Desk REST base URL from a token response `api_domain`
 * (e.g. `https://www.zohoapis.eu` -> `https://desk.zoho.eu`). Zoho returns the
 * data-center-scoped `api_domain` on the `www.zohoapis.*` host, but the Desk
 * REST API lives on `desk.zoho.*` in the same data center. Deriving the Desk
 * base (instead of assuming `desk.zoho.com`) honors data residency.
 *
 * Shared by the OAuth token exchange, which persists the result on the
 * credential, and by the client-credentials service-account minter, which
 * returns it alongside the minted token - the two must not drift.
 *
 * @returns the derived Desk base, or {@link DEFAULT_ZOHO_DESK_BASE} when
 * `apiDomain` is absent, unparseable, or not a Zoho host.
 */
export function deriveZohoDeskBaseFromApiDomain(apiDomain?: string): string {
  return tryDeriveZohoDeskBaseFromApiDomain(apiDomain) ?? DEFAULT_ZOHO_DESK_BASE
}

/**
 * Marker under which the OAuth token exchange persists the data-center-scoped
 * Desk REST base inside the credential's stored scope string.
 *
 * The trailing pattern stops at a comma or whitespace: better-auth persists
 * Zoho's scopes comma-joined (no spaces), so a greedy `\S+` would swallow the
 * whole scope list into the host. The Desk base URL itself never contains a
 * comma or a space.
 */
const ZOHO_DESK_BASE_URL_MARKER = /__zoho_domain__:([^\s,]+)/

/**
 * Read the persisted data-center Desk base out of an OAuth credential's scope
 * string, returning it only when it is a token-safe https Zoho host. Callers
 * that get `undefined` fall back to {@link DEFAULT_ZOHO_DESK_BASE} rather than
 * letting an unrecognized value receive the OAuth token.
 */
export function extractZohoDeskBaseFromScope(scope: string | null | undefined): string | undefined {
  if (typeof scope !== 'string') return undefined
  const candidate = scope.match(ZOHO_DESK_BASE_URL_MARKER)?.[1]
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !isZohoHost(url.hostname)) return undefined
    return candidate.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

/**
 * Assert that a URL is a token-safe Zoho target: it must be `https:` and its host
 * must be a Zoho apex or subdomain. Returns the parsed URL, or throws (the caller
 * maps that to a 400) - used by every route that sends the OAuth token to a host
 * derived from user/LLM-influenced input.
 */
export function assertZohoUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !isZohoHost(url.hostname)) {
    throw new Error('URL must be an https Zoho host')
  }
  return url
}
