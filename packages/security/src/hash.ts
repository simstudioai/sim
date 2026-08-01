import { createHash } from 'node:crypto'

/**
 * Deterministic SHA-256 digest, hex-encoded. Strings hash as UTF-8; binary
 * content passes as a Uint8Array/Buffer. Use for indexed lookup of sensitive
 * values (e.g. API key hash columns) and content-integrity receipts where the
 * caller only needs to verify equality without ever reversing the hash.
 *
 * NOT for human-chosen passwords — those are low-entropy and need a slow KDF.
 * User credentials never reach this helper: Better Auth owns them and applies
 * its own KDF. What does reach it is high-entropy material where a fast digest
 * is the correct construction:
 *
 * - API keys (`sim_`/`sk-sim-` + `generateSecureToken(24)`, 192 random bits).
 *   A slow KDF here would buy nothing against a keyspace that cannot be
 *   searched, while forcing every authenticated request through it.
 * - Already-encrypted values, content digests, and cache/idempotency keys.
 *
 * CodeQL's `js/insufficient-password-hash` flags the sink because callers pass
 * arguments it name-matches as passwords (`apiKey`, `encryptedPassword`). The
 * suppressions below record that judgement; keep the invariant above true, and
 * route any genuine password through Better Auth rather than this function.
 */
export function sha256Hex(input: string | Uint8Array): string {
  const hash = createHash('sha256')
  if (typeof input === 'string') {
    hash.update(input, 'utf8') // lgtm[js/insufficient-password-hash]
  } else {
    hash.update(input) // lgtm[js/insufficient-password-hash]
  }
  return hash.digest('hex')
}

/**
 * SHA-256 digest, base64url-encoded. The encoding PKCE specifies for a code
 * challenge (RFC 7636), so both sides of a challenge/verifier exchange can
 * derive it from one implementation instead of two that must stay in step.
 */
export function sha256Base64Url(input: string | Uint8Array): string {
  const hash = createHash('sha256')
  if (typeof input === 'string') {
    hash.update(input, 'utf8')
  } else {
    hash.update(input)
  }
  return hash.digest('base64url')
}
