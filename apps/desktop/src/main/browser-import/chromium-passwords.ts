import type { ImportCandidate } from '@/main/browser-credentials/vault'
import { decryptChromiumValue } from '@/main/browser-import/chromium-crypto'
import { queryBrowserDatabase } from '@/main/browser-import/sqlite-source'
import { toNumber, toText } from '@/main/browser-import/types'

/**
 * Decrypts a Chrome profile's saved passwords.
 *
 * Same Keychain key and `v10` scheme as the cookie reader, with one
 * difference: password plaintext carries no domain-bound prefix, so no
 * `domain` is passed to the decryptor and nothing is stripped.
 *
 * The values produced here are the most sensitive material the importer
 * handles. They are passed straight to the encrypted vault and are never
 * logged, counted by site, or returned to a renderer.
 */

const MAX_LOGIN_ROWS = 20_000

const LOGIN_QUERY = `
  SELECT signon_realm, origin_url, username_value, password_value, blacklisted_by_user,
         date_password_modified, date_created
  FROM logins
  LIMIT ${MAX_LOGIN_ROWS}
`

export interface BrowserPasswordCandidate extends ImportCandidate {
  /** Chromium timestamp used only to resolve local/account store conflicts. */
  sourceModifiedAt?: bigint
}

export interface ReadPasswordsResult {
  credentials: BrowserPasswordCandidate[]
  skipped: number
  /** Rows examined, so the caller can tell "no passwords" from "none decrypted". */
  rowsSeen: number
}

export async function readBrowserPasswords(
  loginDataPath: string,
  key: Buffer
): Promise<ReadPasswordsResult> {
  const rows = await queryBrowserDatabase(loginDataPath, 'Login Data', LOGIN_QUERY)
  const credentials: BrowserPasswordCandidate[] = []
  let skipped = 0

  for (const raw of rows) {
    // "Never saved for this site" rows exist to suppress Chrome's save prompt
    // and carry no usable password.
    if (toNumber(raw.blacklisted_by_user) !== 0) {
      skipped += 1
      continue
    }

    const encrypted = raw.password_value
    if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) {
      skipped += 1
      continue
    }

    const password = decryptChromiumValue(Buffer.from(encrypted), key)
    if (password === null || password.length === 0) {
      skipped += 1
      continue
    }

    // `signon_realm` is Chrome's authority for where a credential belongs;
    // `origin_url` is the page it was captured on. Federated and Android
    // realms do not reduce to an http(s) origin and are dropped by the vault's
    // own normalization rather than being coerced into one here.
    const origin = toText(raw.signon_realm) || toText(raw.origin_url)
    const modifiedAt = chromiumTimestamp(raw.date_password_modified)
    const createdAt = chromiumTimestamp(raw.date_created)
    credentials.push({
      origin,
      username: toText(raw.username_value),
      password,
      sourceModifiedAt: modifiedAt > 0n ? modifiedAt : createdAt,
    })
  }

  return { credentials, skipped, rowsSeen: rows.length }
}

function chromiumTimestamp(value: unknown): bigint {
  if (typeof value === 'bigint') return value > 0n ? value : 0n
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return BigInt(Math.trunc(value))
  }
  return 0n
}
