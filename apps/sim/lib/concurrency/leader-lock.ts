import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'

const logger = createLogger('LeaderLock')

const DEFAULT_TTL_SEC = 10
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_MAX_WAIT_MS = 3_000

export interface LeaderLockOptions<T> {
  key: string
  ttlSec?: number
  pollIntervalMs?: number
  maxWaitMs?: number
  onLeader: () => Promise<T | null>
  onFollower: () => Promise<T | null>
}

export async function withLeaderLock<T>(opts: LeaderLockOptions<T>): Promise<T | null> {
  const {
    key,
    ttlSec = DEFAULT_TTL_SEC,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
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

  if (acquired) {
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

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const value = await onFollower()
    if (value !== null) return value
  }

  // The leader may have persisted between our final poll and now; one last check.
  const lastChance = await onFollower()
  if (lastChance !== null) return lastChance

  logger.warn('Follower timed out waiting for leader', { key, maxWaitMs })
  return null
}
