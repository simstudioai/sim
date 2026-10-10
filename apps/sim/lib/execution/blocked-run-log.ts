import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('BlockedRunLog')

/**
 * How long one blocked-run log row stands for every later refusal of the same
 * workflow by the same gate. A sender that retries a refused delivery would
 * otherwise write a fresh execution row, trace archive, and file-ownership row
 * per attempt; one row per window still tells the owner their runs are blocked.
 */
export const BLOCKED_RUN_LOG_WINDOW_SECONDS = 15 * 60

/** Used only when Redis is not configured, so a single-process deployment still collapses retries. */
const localClaims = new LRUCache<string, true>({
  max: 10_000,
  ttl: BLOCKED_RUN_LOG_WINDOW_SECONDS * 1000,
})

/**
 * Claims the right to record this window's blocked-run log row for a workflow
 * and gate. Returns false when another refusal already recorded one. A Redis
 * failure returns true: a duplicate row is better than hiding that runs are blocked.
 */
export async function claimBlockedRunLog(workflowId: string, gate: string): Promise<boolean> {
  const key = `blocked-run-log:v1:${workflowId}:${gate}`
  const redis = getRedisClient()
  if (!redis) {
    if (localClaims.has(key)) return false
    localClaims.set(key, true)
    return true
  }

  try {
    const claimed = await redis.set(key, '1', 'EX', BLOCKED_RUN_LOG_WINDOW_SECONDS, 'NX')
    return claimed === 'OK'
  } catch (error) {
    logger.warn('Blocked-run log claim failed; recording the row', {
      workflowId,
      gate,
      error: getErrorMessage(error),
    })
    return true
  }
}
