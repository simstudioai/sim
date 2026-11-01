import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'

const logger = createLogger('LeaderLock')

const DEFAULT_TTL_SEC = 10
const DEFAULT_POLL_INTERVAL_MS = 100

export interface LeaderLockOptions<T> {
  key: string
  ttlSec?: number
  pollIntervalMs?: number
  /**
   * How long a follower polls before its takeover try. Defaults to the lease TTL so that try comes
   * after a dead leader's lease has lapsed; a shorter wait can only take over a released lease.
   */
  maxWaitMs?: number
  onLeader: () => Promise<T | null>
  onFollower: () => Promise<T | null>
}

/**
 * Runs `onLeader` in the one caller that takes the lock for `key`; every other caller polls
 * `onFollower` until it reports the leader's result or `maxWaitMs` passes. A follower whose wait
 * ends with nothing tries the lock once more: a leader whose process died without releasing it
 * leaves the lease to lapse, and that follower then leads instead of failing. Losing that try
 * means a live holder has the lease, and the follower returns `null`.
 */
export async function withLeaderLock<T>(opts: LeaderLockOptions<T>): Promise<T | null> {
  const {
    key,
    ttlSec = DEFAULT_TTL_SEC,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs = ttlSec * 1000,
    onLeader,
    onFollower,
  } = opts

  const ownerToken = generateShortId()

  let acquired = false
  try {
    acquired = await acquireLock(key, ownerToken, ttlSec)
  } catch (error) {
    logger.warn('Lock acquisition failed; running leader path uncoordinated', {
      key,
      error: toError(error).message,
    })
    return onLeader()
  }

  const leadHoldingLock = async () => {
    try {
      return await onLeader()
    } finally {
      try {
        await releaseLock(key, ownerToken)
      } catch (error) {
        logger.warn('Lock release failed (will expire via TTL)', {
          key,
          error: toError(error).message,
        })
      }
    }
  }

  if (acquired) return leadHoldingLock()

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const value = await onFollower()
    if (value !== null) return value
  }

  // The leader may have persisted between our final poll and now; one last check.
  const lastChance = await onFollower()
  if (lastChance !== null) return lastChance

  let tookOver = false
  try {
    tookOver = await acquireLock(key, ownerToken, ttlSec)
  } catch (error) {
    logger.warn('Lock takeover failed after the follower wait', {
      key,
      error: toError(error).message,
    })
  }
  if (tookOver) {
    logger.warn('Follower took over a lease its leader left to lapse', { key, maxWaitMs })
    return leadHoldingLock()
  }

  logger.warn('Follower timed out waiting for leader', { key, maxWaitMs })
  return null
}
