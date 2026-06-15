import type { NextRequest } from 'next/server'
import { isSameOrigin } from '@/lib/core/utils/validation'

/**
 * Returns true when a request demonstrably originates from the application's own
 * front-end (a same-origin browser fetch), and false for cross-site or
 * non-browser callers — e.g. a script replaying a leaked/borrowed session cookie.
 *
 * `Sec-Fetch-Site` is computed by the browser and is a forbidden header, so it
 * cannot be set by `fetch`, `curl`, or a server-side HTTP client. It is therefore
 * the primary, unforgeable signal. When it is absent (rare; older clients), we
 * fall back to an `Origin` same-origin check — a browser `fetch` POST always
 * sends `Origin`, so a missing `Origin` here indicates a non-browser caller and
 * is rejected (secure default).
 *
 * Intended to guard session-cookie-authenticated, state-changing routes against
 * cross-site request forgery and cookie-replay automation. API-key / public-API
 * / internal-JWT callers do not use cookies and must not be gated by this.
 */
export function isSameOriginBrowserRequest(req: NextRequest): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')
  if (secFetchSite) {
    return secFetchSite === 'same-origin' || secFetchSite === 'same-site'
  }

  const origin = req.headers.get('origin')
  if (!origin) return false
  return isSameOrigin(origin)
}
