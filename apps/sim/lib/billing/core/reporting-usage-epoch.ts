import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import type Redis from 'ioredis'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { getRedisClient } from '@/lib/core/config/redis'
import { withinDeadline } from '@/lib/core/utils/deadline'

const logger = createLogger('ReportingUsageEpoch')

/** Bump when a stored sum's meaning changes; old entries are then ignored. */
export const SHARED_KEY_VERSION = 'v1'

/**
 * How long a read waits on a connected Redis before summing the ledger instead, so a socket that
 * has silently stopped answering costs one sum rather than the shared client's long timeouts.
 */
export const SHARED_READ_TIMEOUT_MS = 250

/**
 * How far behind the clock a prefix's cutoff sits. A row's `created_at` is its transaction's
 * start on the database clock, so a row stamped just before the cutoff can still be uncommitted
 * when the prefix is read; this lag puts every such row in the tail, which is summed on every
 * refill, rather than in a prefix that would miss it until its next refresh. It also absorbs
 * skew between this process's clock and the database's.
 */
export const PREFIX_CUTOFF_LAG_MS = 5 * 60_000

/**
 * The age past which a topped-up row may sit inside a stored prefix, so its top-up discards the
 * payer's prefixes. A minute short of {@link PREFIX_CUTOFF_LAG_MS}: every cutoff is at least the
 * lag behind its reader's clock, and the margin covers skew between that clock, this one, and
 * the database's that stamped the row. A younger row is still in every tail.
 */
const TOP_UP_INVALIDATES_AFTER_MS = PREFIX_CUTOFF_LAG_MS - 60_000

/**
 * How long a bumped prefix epoch is kept. Every prefix written before the bump has expired well
 * before this, so the epoch reading as absent again afterwards cannot revive one.
 */
const PREFIX_EPOCH_RETAIN_MS = 60 * 60_000

/**
 * One value for every payer: a prefix is served only while the epoch it was summed under is
 * still current, so replacing the epoch discards every stored prefix at once.
 */
export const SHARED_PREFIX_EPOCH_KEY = `usage:reporting:${SHARED_KEY_VERSION}:prefix-epoch`

/** Like {@link SHARED_PREFIX_EPOCH_KEY}, for one payer's prefixes only. */
export function payerPrefixEpochKey(entity: BillingEntity): string {
  return `${SHARED_PREFIX_EPOCH_KEY}:${entity.type}:${entity.id}`
}

/**
 * The shared client, only while its connection is ready. A disconnected client parks commands in
 * its offline queue and replays them on reconnect, which would land a stale sum with a fresh
 * expiry, and `NX` would then keep newer sums out; so while it is not ready, no command is issued
 * at all and the ledger answers instead. Trigger.dev's `init` hook warms the connection, so it is
 * ready by the time a task reads.
 */
export function readyRedisClient(): Redis | null {
  const redis = getRedisClient()
  return redis?.status === 'ready' ? redis : null
}

/**
 * Throws when a configured Redis is not ready, since its stored prefixes then outlive the bump:
 * each caller logs that like a failed or timed-out SET. Without Redis there is nothing to discard.
 */
async function replaceEpoch(epochKey: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  if (redis.status !== 'ready') throw new Error(`Redis not ready (${redis.status})`)
  await withinDeadline(
    () => redis.set(epochKey, generateShortId(), 'PX', PREFIX_EPOCH_RETAIN_MS),
    Date.now() + SHARED_READ_TIMEOUT_MS
  )
}

/**
 * Discards every stored prefix, for a write that removes ledger rows — a user's deletion, whose
 * rows cascade away. Call it once that write has committed: a refresh that read the old epoch
 * stores its prefix under it, where nothing reads it, and one that reads the new epoch sums after
 * the deletion. Best effort: a bump that fails, times out, or finds Redis not ready leaves the
 * deleted usage counted until the stored prefixes expire, and is logged.
 */
export async function invalidateReportingUsagePrefixes(): Promise<void> {
  try {
    await replaceEpoch(SHARED_PREFIX_EPOCH_KEY)
  } catch (error) {
    logger.warn('Shared reporting usage prefix invalidation failed', {
      error: getErrorMessage(error),
    })
  }
}

/**
 * Discards the payer's stored prefixes when a committed top-up raised a row old enough to sit
 * inside one, so the next read sums the window again and sees the top-up as soon as an uncached
 * read would. Like {@link invalidateReportingUsagePrefixes}, a refresh racing it stores under
 * the epoch it read, where nothing reads it once this lands. Fire-and-forget and best effort: a
 * failed bump leaves the top-up unseen until the payer's prefixes expire.
 */
export function invalidatePayerPrefixesForTopUp(entity: BillingEntity, rowCreatedAt: Date): void {
  if (rowCreatedAt.getTime() >= Date.now() - TOP_UP_INVALIDATES_AFTER_MS) return
  replaceEpoch(payerPrefixEpochKey(entity)).catch((error) => {
    logger.warn('Shared reporting usage payer prefix invalidation failed', {
      payerType: entity.type,
      error: getErrorMessage(error),
    })
  })
}
