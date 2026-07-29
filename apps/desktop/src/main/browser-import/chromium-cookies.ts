import { decryptChromiumValue } from '@/main/browser-import/chromium-crypto'
import { translateCookieRow } from '@/main/browser-import/cookie-translate'
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

const COOKIE_QUERY = `
  SELECT host_key, name, path, expires_utc, is_secure, is_httponly,
         has_expires, is_persistent, samesite, encrypted_value, value
  FROM cookies
  LIMIT ${MAX_COOKIE_ROWS}
`

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

/**
 * Rows that fail to decrypt or cannot be aimed at a single host are counted,
 * not thrown — one unreadable cookie should not cost the user the other
 * thousand.
 */
export async function readBrowserCookies(
  cookiesPath: string,
  key: Buffer,
  nowSeconds: number = Date.now() / 1000
): Promise<ReadCookiesResult> {
  const rows = await queryBrowserDatabase(cookiesPath, 'Cookies', COOKIE_QUERY)
  const cookies: ImportableCookie[] = []
  const skipped = emptySkipCounts()

  for (const raw of rows) {
    const row = toRow(raw)
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

  return { cookies, skipped, rowsSeen: rows.length }
}
