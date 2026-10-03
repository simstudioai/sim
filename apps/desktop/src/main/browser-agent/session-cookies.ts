import type { CookiesSetDetails, Session } from 'electron'

/**
 * Session cookies in the browser partition get this lifetime instead of dying
 * with the process.
 *
 * Electron hard-codes Chromium's `persist_session_cookies` and
 * `restore_old_session_cookies` to false, so a `persist:` partition still drops
 * every expiry-less cookie on quit — which signs the user out of any site that
 * keeps its login in one, whether it was imported from Chrome or set here.
 * Chrome keeps them across restarts under "continue where you left off"; this
 * matches that, bounded. The site re-sending the cookie renews the window, so
 * only a login left untouched for this long lapses.
 */
export const SESSION_COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60

/** Gives an expiry-less cookie the bounded lifetime; cookies that already expire are unchanged. */
export function withSessionCookieLifetime(
  cookie: CookiesSetDetails,
  nowSeconds: number
): CookiesSetDetails {
  if (cookie.expirationDate !== undefined) return cookie
  return { ...cookie, expirationDate: nowSeconds + SESSION_COOKIE_LIFETIME_SECONDS }
}

/**
 * Adds `Max-Age` to a `Set-Cookie` value that has neither `Expires` nor
 * `Max-Age`. Deletions carry one of the two, so they pass through untouched.
 */
export function withSessionCookieMaxAge(setCookie: string): string {
  const attributes = setCookie.split(';').slice(1)
  const expires = attributes.some((attribute) => {
    const name = attribute.split('=', 1)[0].trim().toLowerCase()
    return name === 'expires' || name === 'max-age'
  })
  return expires ? setCookie : `${setCookie}; Max-Age=${SESSION_COOKIE_LIFETIME_SECONDS}`
}

/**
 * Makes session cookies a site sets over HTTP survive an app restart.
 *
 * The rewrite happens on the response headers, before Chromium stores the
 * cookie, so it is created persistent in the same order as every other cookie
 * write — a later deletion from the site still wins. Rewriting stored cookies
 * after the fact would race exactly that: login redirects set and clear
 * short-lived cookies milliseconds apart. Cookies set from page script
 * (`document.cookie`) are not covered; they cannot be `HttpOnly`, so session
 * logins rarely live in them.
 */
export function keepSessionCookiesAcrossRestarts(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders
    const key = headers && Object.keys(headers).find((name) => name.toLowerCase() === 'set-cookie')
    if (!headers || !key) {
      callback({})
      return
    }
    callback({ responseHeaders: { ...headers, [key]: headers[key].map(withSessionCookieMaxAge) } })
  })
}
