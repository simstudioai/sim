import type { NextRequest } from 'next/server'
import { isSameOrigin } from '@/lib/core/utils/validation'

/**
 * Returns true when a request is provably cross-origin — a browser fetch driven
 * from a different site than our own. Used to reject session-cookie CSRF on
 * state-changing routes: a cross-site browser request always carries
 * `Sec-Fetch-Site: cross-site` or a mismatched `Origin`, and neither header can
 * be set by in-browser attacker JavaScript (both are forbidden headers).
 *
 * `Sec-Fetch-Site` is the primary signal; only `same-origin` is treated as our
 * own front-end. The app is single-origin, so `same-site` (sibling subdomains),
 * `cross-site`, and `none` are all rejected. When it is absent, fall back to an
 * `Origin` same-origin check. When neither header is present the origin cannot
 * be determined, so the request is allowed — a genuine cross-site browser attack
 * cannot omit these headers.
 *
 * This is CSRF protection only. It does not defend against a non-browser client
 * that forges headers directly (no header-based check can); that surface is
 * covered by the credit and execution rate-limit gates.
 */
export function isCrossOriginSessionRequest(req: NextRequest): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')
  if (secFetchSite) {
    return secFetchSite !== 'same-origin'
  }

  const origin = req.headers.get('origin')
  if (!origin) return false

  try {
    return !isSameOrigin(origin)
  } catch {
    return false
  }
}
