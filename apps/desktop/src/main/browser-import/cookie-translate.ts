import type {
  ChromiumCookieRow,
  CookieSkipReason,
  ImportableCookie,
} from '@/main/browser-import/types'

/**
 * Translates Chrome cookie rows into the shape Electron's cookie API accepts.
 *
 * Two rules govern everything here. Security attributes are preserved exactly
 * — `Secure`, `HttpOnly`, `SameSite`, host-only versus domain scope, and path
 * are carried across unchanged, and a cookie is dropped rather than imported
 * under weaker terms. And the destination is derived, never trusted: a corrupt
 * or hostile `host_key` must not be able to steer a cookie at a host other
 * than the one it came from.
 */

/** Chrome stores timestamps as microseconds since 1601-01-01 UTC. */
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600
const MICROSECONDS_PER_SECOND = 1_000_000

export function chromeTimeToUnixSeconds(chromeTime: number): number {
  return chromeTime / MICROSECONDS_PER_SECOND - WINDOWS_EPOCH_OFFSET_SECONDS
}

/** Chrome's `samesite` column: -1 unspecified, 0 None, 1 Lax, 2 Strict. */
function toSameSite(value: number): ImportableCookie['sameSite'] {
  switch (value) {
    case 0:
      return 'no_restriction'
    case 1:
      return 'lax'
    case 2:
      return 'strict'
    default:
      return 'unspecified'
  }
}

/**
 * Builds the URL the cookie is written against, or null when the row cannot
 * be trusted to describe one host.
 *
 * `host_key` comes from a database this process does not own, so the parsed
 * URL is checked back against it: anything that reparses to a different host,
 * or that smuggles in credentials, a port, or extra path structure, is
 * refused instead of being normalised into something plausible.
 */
export function buildCookieUrl(hostKey: string, path: string, secure: boolean): string | null {
  const bareHost = hostKey.replace(/^\./, '').toLowerCase()
  if (bareHost.length === 0 || bareHost.length > 253) return null
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  try {
    const url = new URL(`${secure ? 'https' : 'http'}://${bareHost}${normalizedPath}`)
    if (url.hostname !== bareHost || url.username || url.password || url.port) return null
    return url.toString()
  } catch {
    return null
  }
}

export type TranslationOutcome =
  | { ok: true; cookie: ImportableCookie }
  | { ok: false; reason: CookieSkipReason }

/**
 * Converts one decrypted row, or explains why it was dropped.
 *
 * `nowSeconds` is injected so expiry is evaluated against a single instant for
 * the whole import rather than drifting row to row.
 */
export function translateCookieRow(
  row: ChromiumCookieRow,
  value: string,
  nowSeconds: number
): TranslationOutcome {
  if (row.name.length === 0 && value.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  const url = buildCookieUrl(row.hostKey, row.path, row.isSecure)
  if (url === null) {
    return { ok: false, reason: 'invalid-target' }
  }

  const cookie: ImportableCookie = {
    url,
    name: row.name,
    value,
    // A leading dot is Chrome's marker for a domain cookie. Host-only cookies
    // omit `domain` entirely so Electron scopes them to the URL's host —
    // sending the bare host instead would widen them to every subdomain.
    ...(row.hostKey.startsWith('.') ? { domain: row.hostKey } : {}),
    path: row.path.startsWith('/') ? row.path : `/${row.path}`,
    secure: row.isSecure,
    httpOnly: row.isHttpOnly,
    sameSite: toSameSite(row.sameSite),
  }

  if (row.hasExpires && row.isPersistent) {
    const expirationDate = chromeTimeToUnixSeconds(row.expiresUtc)
    if (!Number.isFinite(expirationDate) || expirationDate <= nowSeconds) {
      return { ok: false, reason: 'expired' }
    }
    cookie.expirationDate = expirationDate
  }

  return { ok: true, cookie }
}
