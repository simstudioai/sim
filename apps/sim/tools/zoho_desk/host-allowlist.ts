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

/** True only when the hostname is exactly a Zoho apex or a subdomain of one. */
export function isZohoHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ZOHO_ALLOWED_APEX_DOMAINS.some((apex) => host === apex || host.endsWith(`.${apex}`))
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
