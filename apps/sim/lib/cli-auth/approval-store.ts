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
 * Polls for an approval, consuming it exactly once.
 *
 * `pending` covers every non-terminal state — not yet approved, expired, or a
 * wrong `pollSecret` — so the endpoint is not an oracle for which requests
 * exist or whether a secret is close. The approving user is returned only to a
 * caller that proves possession of the secret.
 *
 * Verifies *before* deleting: an attacker who knows the semi-public `requestId`
 * but not the secret can never trigger the delete, so they cannot cancel a
 * pending approval. The atomic `del` (returns the count removed) then makes the
 * claim single-use — two concurrent valid polls can't both mint.
 */
export async function pollApproval(requestId: string, pollSecret: string): Promise<PollResult> {
  const redis = requireRedis()
  const key = approvalKey(requestId)

  const raw = await redis.get(key)
  if (!raw) return { status: 'pending' }

  const record = JSON.parse(raw) as ApprovalRecord
  if (!safeCompare(sha256Base64Url(pollSecret), record.challenge)) return { status: 'pending' }

  const claimed = await redis.del(key)
  if (claimed !== 1) return { status: 'pending' }

  return { status: 'approved', userId: record.userId }
}
