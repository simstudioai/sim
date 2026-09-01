import { createLogger } from '@sim/logger'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { hasUsableEncryptionKey } from '@/lib/core/security/encryption'
import {
  ACCOUNT_TOKEN_FIELDS,
  AccountTokenDecryptionError,
  type AccountTokenField,
  decryptAccountToken,
  encryptAccountToken,
} from '@/lib/oauth/account-token-crypto'

const logger = createLogger('AccountTokens')

/** The three protected columns on the `account` table. */
export type AccountTokenColumns = {
  [K in AccountTokenField]: string | null
}

declare const decryptedTokensBrand: unique symbol

/**
 * A row whose token columns hold plaintext. The brand is minted only by this module, so a
 * raw Drizzle row will not type-check where a decrypted one is required.
 *
 * A brand cannot stop an `any`, which is why `refreshTokenIfNeeded`'s parameter was typed
 * rather than annotated. The durable guarantee is structural: only the modules allowlisted
 * in `scripts/check-account-token-access.ts` may select a token column at all.
 */
export type DecryptedAccount<T> = T & { readonly [decryptedTokensBrand]: true }

/**
 * True when new writes should be enveloped. Reads never consult this — they detect the
 * format per value — so flipping the flag can never strand a row.
 */
async function canEncryptAccountTokens(): Promise<boolean> {
  if (!(await isFeatureEnabled('oauth-token-encryption'))) return false
  if (!hasUsableEncryptionKey()) {
    warnOnceAboutUnusableKey()
    return false
  }
  return true
}

let warnedAboutUnusableKey = false

function warnOnceAboutUnusableKey(): void {
  if (warnedAboutUnusableKey) return
  warnedAboutUnusableKey = true
  logger.error(
    'oauth-token-encryption is enabled but ENCRYPTION_KEY is not a 64-character hex string; account tokens will continue to be written in plaintext'
  )
}

/**
 * Envelopes whichever token fields are present, leaving every other key untouched.
 *
 * Field-local by necessity: `update.before` also fires for password changes and for
 * expiry-only updates, so an absent field must stay absent rather than being coerced to
 * `null` — that would blank the user's tokens. A payload carrying no token at all short-
 * circuits before the flag, since whether it needs encrypting is not a flag question.
 */
export async function encryptAccountTokenColumns<T extends Partial<AccountTokenColumns>>(
  data: T
): Promise<T> {
  if (!ACCOUNT_TOKEN_FIELDS.some((field) => data[field])) return data
  if (!(await canEncryptAccountTokens())) return data

  const next = { ...data }
  for (const field of ACCOUNT_TOKEN_FIELDS) {
    const value = data[field]
    if (typeof value !== 'string' || value === '') continue
    /**
     * Deliberately unguarded. The only expected reason encryption cannot run is an unusable
     * key, and the gate above already returned for that. Anything throwing here is a real
     * fault, and swallowing it would silently store a plaintext token while the flag reports
     * encryption as on — the exact guarantee this module exists to provide.
     */
    next[field] = (await encryptAccountToken(value)) as T[typeof field]
  }
  return next
}

/**
 * Recovers whichever token fields are present. Never throws — an unreadable field becomes
 * `null`, so one poisoned row cannot fail a whole list surface.
 *
 * The stored row is never mutated. A decrypt failure is a key or configuration fault, and
 * this codebase has no key rotation, so nulling the column would turn a recoverable
 * misconfiguration into unrecoverable credential loss. Callers that dead-flag a credential
 * must treat the `null` as "unavailable", never as "revoked" — see `getFreshestSlackChain`,
 * where a bad key would otherwise block a whole Slack installation for an hour.
 */
export async function decryptAccountTokenColumns<T extends Partial<AccountTokenColumns>>(
  row: T
): Promise<DecryptedAccount<T>> {
  const next = { ...row } as T

  for (const field of ACCOUNT_TOKEN_FIELDS) {
    const value = row[field]
    if (typeof value !== 'string' || value === '') continue
    try {
      next[field] = (await decryptAccountToken(value, field)) as T[typeof field]
    } catch (error) {
      next[field] = null as T[typeof field]
      logger.error('Failed to decrypt account token', {
        field,
        reason: error instanceof AccountTokenDecryptionError ? error.reason : 'unknown',
      })
    }
  }

  return next as DecryptedAccount<T>
}

/** Batch form for list surfaces (the connections page, the Copilot credential tool). */
export async function decryptAccountTokenColumnsBatch<T extends Partial<AccountTokenColumns>>(
  rows: T[]
): Promise<DecryptedAccount<T>[]> {
  return Promise.all(rows.map((row) => decryptAccountTokenColumns(row)))
}
