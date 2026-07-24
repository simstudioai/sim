import { safeCompare } from '@sim/security/compare'
import { sha256Base64Url, sha256Hex } from '@sim/security/hash'
import { generateShortId } from '@sim/utils/id'
import { getRedisClient } from '@/lib/core/config/redis'

/**
 * Short-lived storage for CLI authorization codes.
 *
 * Redis rather than Postgres: the records are ephemeral and self-expiring, so a
 * table would need a migration plus a sweeper for rows that are garbage two
 * minutes after they're written.
 *
 * The record deliberately holds no credential — the API key is minted at
 * redemption, so an abandoned or expired approval costs nothing and a Redis
 * dump yields nothing redeemable.
 */

const CODE_TTL_MS = 120_000
const CODE_LENGTH = 43

interface AuthCodeRecord {
  /** BASE64URL(SHA256(verifier)) supplied by the CLI via the browser. */
  challenge: string
  /** Always taken from the approving user's session, never from a request body. */
  userId: string
  createdAt: number
}

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('CLI authentication requires Redis. Set REDIS_URL to enable it.')
  }
  return redis
}

/** Codes are bearer tokens, so only their digest is stored. */
function codeKey(code: string): string {
  return `cli:auth:code:${sha256Hex(code)}`
}

/** Shares its implementation with the CLI so the two sides cannot drift apart. */
function challengeFor(verifier: string): string {
  return sha256Base64Url(verifier)
}

/** Returns the plaintext code, which is never stored. */
export async function createAuthCode(userId: string, challenge: string): Promise<string> {
  const redis = requireRedis()
  const code = generateShortId(CODE_LENGTH)
  const record: AuthCodeRecord = { challenge, userId, createdAt: Date.now() }

  await redis.set(codeKey(code), JSON.stringify(record), 'PX', CODE_TTL_MS)

  return code
}

/**
 * Redeems a code, returning the approving user's id, or null when the code is
 * unknown, expired, already used, or paired with the wrong verifier.
 *
 * Deletes before verifying so a code is single-use even under concurrent
 * redemption: a second caller finds nothing regardless of which verifier it
 * presents. Callers must not distinguish the failure modes in their response —
 * doing so turns this into an oracle for which codes exist.
 */
export async function consumeAuthCode(code: string, verifier: string): Promise<string | null> {
  const redis = requireRedis()

  const raw = await redis.getdel(codeKey(code))
  if (!raw) return null

  const record = JSON.parse(raw) as AuthCodeRecord
  if (!safeCompare(challengeFor(verifier), record.challenge)) return null

  return record.userId
}
