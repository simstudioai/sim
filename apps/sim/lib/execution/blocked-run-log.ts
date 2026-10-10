import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('BlockedRunLog')

/**
 * How long one blocked-run log row stands for every later refusal of the same
 * workflow by the same gate. A sender that retries a refused delivery would
 * otherwise write a fresh execution row, trace archive, and file-ownership row
 * per attempt; one row per window still tells the owner their runs are blocked.
 */
export const BLOCKED_RUN_LOG_WINDOW_SECONDS = 15 * 60

/**
 * Claims the right to record this window's blocked-run log row for a workflow
 * and gate. Returns false when another refusal already recorded one. Without
 * Redis, or when Redis fails, it returns true: a duplicate row is better than
 * hiding that runs are blocked. Usage-limit refusals only occur on hosted
 * billing deployments, which always run Redis.
 */
export async function claimBlockedRunLog(workflowId: string, gate: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return true

  try {
    const claimed = await redis.set(
      `blocked-run-log:v1:${workflowId}:${gate}`,
      '1',
      'EX',
      BLOCKED_RUN_LOG_WINDOW_SECONDS,
      'NX'
    )
    return claimed === 'OK'
  } catch (error) {
    logger.debug('Blocked-run log claim failed; recording the row', {
      workflowId,
      gate,
      error: getErrorMessage(error),
    })
    return true
  }
}
