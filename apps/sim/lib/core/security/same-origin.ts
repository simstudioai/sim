import type { NextRequest } from 'next/server'

/**
 * Returns true when a request is provably cross-site — a browser fetch driven
 * from a different site than our own. Used to reject session-cookie CSRF on
 * state-changing routes.
 *
 * `Sec-Fetch-Site` is browser-set and a forbidden header, so page JavaScript
 * cannot forge it. A cross-site browser request (the CSRF threat) always reports
 * `cross-site`. We deliberately accept `same-origin`, `same-site`, and `none`:
 * the app is served across sibling subdomains (e.g. `www.<domain>` calling
 * `<domain>`), so a legitimate `same-site` fetch must NOT be blocked — rejecting
 * it 403s real "Run" requests on those origins. An absent header (older clients)
 * is also allowed; the conventional CSRF posture is to reject only a provable
 * cross-site request.
 *
 * This is CSRF protection only. It does not defend against a non-browser client
 * that forges headers directly (no header check can); that surface is covered by
 * the credit and execution rate-limit gates.
 */
export function isCrossSiteSessionRequest(req: NextRequest): boolean {
  return req.headers.get('sec-fetch-site') === 'cross-site'
}
