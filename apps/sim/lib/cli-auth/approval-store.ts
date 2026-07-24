import { safeCompare } from '@sim/security/compare'
import { sha256Base64Url, sha256Hex } from '@sim/security/hash'
import { getRedisClient } from '@/lib/core/config/redis'

/**
 * Short-lived storage for CLI authorization approvals.
 *
 * The device-flow rendezvous: the CLI polls by `requestId` while the user
 * approves in a browser. The record is created only when a signed-in user
 * approves, so an abandoned flow leaves nothing behind — nothing to expire, and
 * nothing to poll until the click happens.
 *
 * Redis rather than Postgres: the records are ephemeral and self-expiring, so a
 * table would need a migration plus a sweeper for rows that are garbage two
 * minutes after they're written. It holds no credential — the API key is minted
 * at poll time, so a Redis dump yields nothing redeemable.
 */

const APPROVAL_TTL_MS = 120_000
const MINT_LOCK_TTL_MS = 30_000

interface ApprovalRecord {
  /** BASE64URL(SHA256(pollSecret)) — the CLI proves possession of the secret at poll time. */
  challenge: string
  /** Always taken from the approving user's session, never from a request body. */
  userId: string
  createdAt: number
}

export type PollResult = { status: 'pending' } | { status: 'approved'; userId: string }

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('CLI authentication requires Redis. Set REDIS_URL to enable it.')
  }
  return redis
}

/**
 * `requestId` is the rendezvous handle the CLI puts in the browser URL, so it is
 * semi-public (OAuth's `user_code`, not its `device_code`). Hashing it as the
 * key keeps raw ids out of a Redis dump; the actual secret is the pollSecret,
 * never stored in the clear.
 */
function approvalKey(requestId: string): string {
  return `cli:auth:req:${sha256Hex(requestId)}`
}

/** Guards the mint step so two concurrent valid polls can't both mint a key. */
function mintLockKey(requestId: string): string {
  return `cli:auth:mint:${sha256Hex(requestId)}`
}

/** Records a signed-in user's approval. Overwrites any prior approval for the same request. */
export async function createApproval(
  userId: string,
  requestId: string,
  challenge: string
): Promise<void> {
  const redis = requireRedis()
  const record: ApprovalRecord = { challenge, userId, createdAt: Date.now() }
  await redis.set(approvalKey(requestId), JSON.stringify(record), 'PX', APPROVAL_TTL_MS)
}

/**
 * Polls for an approval and reserves the mint slot, without consuming the
 * approval itself.
 *
 * `pending` covers every non-terminal state — not yet approved, expired, a wrong
 * `pollSecret`, or another poll already minting — so the endpoint is not an
 * oracle for which requests exist or whether a secret is close. The approving
 * user is returned only to a caller that proves possession of the secret.
 *
 * Verifies *before* reserving: an attacker who knows the semi-public `requestId`
 * but not the secret can never touch the record. The reservation is an atomic
 * `SET NX` lock (not a delete) so two concurrent valid polls can't both mint,
 * while the approval survives a *failed* mint — the caller releases the lock and
 * a later poll retries, instead of forcing a fresh browser approval. Its short
 * TTL frees the slot if the minting caller dies. Callers MUST finish with
 * {@link completeApproval} on success or {@link releaseMint} on failure.
 */
export async function pollApproval(requestId: string, pollSecret: string): Promise<PollResult> {
  const redis = requireRedis()

  const raw = await redis.get(approvalKey(requestId))
  if (!raw) return { status: 'pending' }

  const record = JSON.parse(raw) as ApprovalRecord
  if (!safeCompare(sha256Base64Url(pollSecret), record.challenge)) return { status: 'pending' }

  const reserved = await redis.set(mintLockKey(requestId), '1', 'PX', MINT_LOCK_TTL_MS, 'NX')
  if (reserved !== 'OK') return { status: 'pending' }

  return { status: 'approved', userId: record.userId }
}

/** Consumes the approval after a successful mint — single-use from here on. */
export async function completeApproval(requestId: string): Promise<void> {
  const redis = requireRedis()
  await redis.del(approvalKey(requestId), mintLockKey(requestId))
}

/** Releases the mint reservation after a failed mint so a later poll can retry. */
export async function releaseMint(requestId: string): Promise<void> {
  const redis = requireRedis()
  await redis.del(mintLockKey(requestId))
}
