import { decryptChromiumValue } from '@/main/browser-import/chromium-crypto'
import { translateCookieRow } from '@/main/browser-import/cookie-translate'
import { isCookieHostInScope, type SiteScope } from '@/main/browser-import/site-scope'
import { queryBrowserDatabase } from '@/main/browser-import/sqlite-source'
import {
  type ChromiumCookieRow,
  type CookieSkipCounts,
  emptySkipCounts,
  type ImportableCookie,
  toNumber,
  toText,
} from '@/main/browser-import/types'

/**
 * Decrypts a Chrome profile's cookies. The source database is copied and read
 * read-only by {@link queryBrowserDatabase}; nothing here writes to Chrome.
 */

const MAX_COOKIE_ROWS = 50_000

const COOKIE_COLUMNS = `
  SELECT host_key, name, path, expires_utc, is_secure, is_httponly,
         has_expires, is_persistent, samesite, encrypted_value, value
  FROM cookies`

/** `%`, `_`, and the escape itself are LIKE metacharacters; a hostname may carry `_`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * The cookie query, narrowed in SQL to a site's rows when there is a scope.
 * The narrowing is only an efficiency: {@link isCookieHostInScope} still
 * decides every row, since LIKE is case-insensitive and knows no labels.
 */
function cookieQuery(scope: SiteScope | undefined): { query: string; params: string[] } {
  if (!scope) return { query: `${COOKIE_COLUMNS} LIMIT ${MAX_COOKIE_ROWS}`, params: [] }
  const exactHosts = [scope.domain, `.${scope.domain}`]
  if (scope.exact) {
    return {
      query: `${COOKIE_COLUMNS} WHERE host_key IN (?, ?) LIMIT ${MAX_COOKIE_ROWS}`,
      params: exactHosts,
    }
  }
  return {
    query: `${COOKIE_COLUMNS} WHERE host_key IN (?, ?) OR host_key LIKE ? ESCAPE '\\' LIMIT ${MAX_COOKIE_ROWS}`,
    params: [...exactHosts, `%.${escapeLike(scope.domain)}`],
  }
}

export interface ReadCookiesResult {
  cookies: ImportableCookie[]
  skipped: CookieSkipCounts
  /** Rows examined, so the caller can tell "no cookies" from "none survived". */
  rowsSeen: number
}

function toRow(raw: Record<string, unknown>): ChromiumCookieRow {
  return {
    hostKey: toText(raw.host_key),
    name: toText(raw.name),
    path: toText(raw.path),
    expiresUtc: toNumber(raw.expires_utc),
    isSecure: toNumber(raw.is_secure) !== 0,
    isHttpOnly: toNumber(raw.is_httponly) !== 0,
    hasExpires: toNumber(raw.has_expires) !== 0,
    isPersistent: toNumber(raw.is_persistent) !== 0,
    sameSite: toNumber(raw.samesite),
  }
}

interface ReadCookiesOptions {
  nowSeconds?: number
  /** Limits the read to one site; other rows are never decrypted, returned, or counted. */
  scope?: SiteScope
}

/**
 * Rows that fail to decrypt or cannot be aimed at a single host are counted,
 * not thrown — one unreadable cookie should not cost the user the other
 * thousand.
 */
export async function readBrowserCookies(
  cookiesPath: string,
  key: Buffer,
  { nowSeconds = Date.now() / 1000, scope }: ReadCookiesOptions = {}
): Promise<ReadCookiesResult> {
  const { query, params } = cookieQuery(scope)
  const rows = await queryBrowserDatabase(cookiesPath, 'Cookies', query, params)
  const cookies: ImportableCookie[] = []
  const skipped = emptySkipCounts()
  let rowsSeen = 0

  for (const raw of rows) {
    const row = toRow(raw)
    if (scope && !isCookieHostInScope(row.hostKey, scope)) continue
    rowsSeen += 1
    const encrypted = raw.encrypted_value
    let value: string | null
    if (encrypted instanceof Uint8Array && encrypted.length > 0) {
      value = decryptChromiumValue(Buffer.from(encrypted), key, { domain: row.hostKey })
    } else {
      // Pre-encryption rows keep their value in the plain `value` column.
      value = toText(raw.value)
    }
    if (value === null) {
      skipped['decrypt-failed'] += 1
      continue
    }

    const outcome = translateCookieRow(row, value, nowSeconds)
    if (outcome.ok) {
      cookies.push(outcome.cookie)
    } else {
      skipped[outcome.reason] += 1
    }
  }

  return { cookies, skipped, rowsSeen }
}
