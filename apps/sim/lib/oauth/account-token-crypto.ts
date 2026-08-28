import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

/**
 * Marks a stored `account` token column as ciphertext. Detection is an exact prefix match,
 * never a shape or length heuristic.
 *
 * Better Auth ships its own `account.encryptOAuthTokens` and we deliberately do not use it:
 * it keys off `BETTER_AUTH_SECRET` instead of `ENCRYPTION_KEY`, leaves `idToken` in
 * plaintext despite its documentation, decrypts only inside Better Auth's own endpoints
 * rather than on the direct database reads this app performs, and detects ciphertext by
 * treating any even-length hex string as encrypted — which is the shape of a real Trello or
 * Airtable token. The two schemes are mutually exclusive: its detector does not recognize
 * this prefix, so enabling that flag later would pass our ciphertext through undecrypted.
 */
const ENVELOPE_PREFIX = 'simenc:'

/** Current envelope version. The payload after this prefix is `iv:ciphertext:authTag`. */
const ENVELOPE_V1_PREFIX = `${ENVELOPE_PREFIX}v1:`

/** The `account` columns this module protects. */
export type AccountTokenField = 'accessToken' | 'refreshToken' | 'idToken'

/**
 * Thrown when a prefixed value cannot be recovered — wrong `ENCRYPTION_KEY`, truncated
 * column, or an unknown envelope version. Never thrown for legacy plaintext.
 */
export class AccountTokenDecryptionError extends Error {
  constructor(
    readonly field: AccountTokenField,
    readonly reason: 'unknown-version' | 'decrypt-failed',
    cause?: unknown
  ) {
    super(`Failed to decrypt ${field}: ${reason}`, cause ? { cause } : undefined)
    this.name = 'AccountTokenDecryptionError'
  }
}

/** True when a stored column value is one of our envelopes rather than legacy plaintext. */
export function isEncryptedAccountToken(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
}

/**
 * Wraps a token in the current envelope. Idempotent, which is what makes a retried backfill
 * batch safe.
 *
 * Empty strings pass through: `@better-auth/sso` writes `accessToken: ''` for SAML rows,
 * and enveloping that would make it truthy, flipping every `if (account.accessToken)` guard.
 */
export async function encryptAccountToken(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext
  if (isEncryptedAccountToken(plaintext)) return plaintext

  const { encrypted } = await encryptSecret(plaintext)
  return `${ENVELOPE_V1_PREFIX}${encrypted}`
}

/**
 * Recovers a token written by {@link encryptAccountToken}. Unprefixed values are legacy
 * plaintext and pass through, which is what lets a mixed-format table be read during rollout.
 *
 * A prefixed value that will not decrypt throws rather than passing through: forwarding
 * ciphertext to a provider looks exactly like a revoked credential and gets diagnosed wrong.
 */
export async function decryptAccountToken(
  value: string,
  field: AccountTokenField
): Promise<string> {
  if (!value) return value
  if (!isEncryptedAccountToken(value)) return value

  if (!value.startsWith(ENVELOPE_V1_PREFIX)) {
    throw new AccountTokenDecryptionError(field, 'unknown-version')
  }

  /** `decryptSecret` reads segment 0 as the IV, so the prefix must come off first. */
  const payload = value.slice(ENVELOPE_V1_PREFIX.length)

  try {
    const { decrypted } = await decryptSecret(payload)
    return decrypted
  } catch (error) {
    throw new AccountTokenDecryptionError(field, 'decrypt-failed', error)
  }
}
