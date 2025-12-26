import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('ExecutionCancellation')

const EXECUTION_CANCEL_PREFIX = 'execution:cancel:'
const EXECUTION_CANCEL_EXPIRY = 60 * 60

export function isRedisCancellationEnabled(): boolean {
  return getRedisClient() !== null
}

/**
 * Mark an execution as cancelled in Redis.
 * Returns true if Redis is available and the flag was set, false otherwise.
 */
export async function markExecutionCancelled(executionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return false
  }

  try {
    await redis.set(`${EXECUTION_CANCEL_PREFIX}${executionId}`, '1', 'EX', EXECUTION_CANCEL_EXPIRY)
    logger.info('Marked execution as cancelled', { executionId })
    return true
  } catch (error) {
    logger.error('Failed to mark execution as cancelled', { executionId, error })
    return false
  }
}

/**
 * Check if an execution has been cancelled via Redis.
 * Returns false if Redis is not available (fallback to local abort signal).
 */
export async function isExecutionCancelled(executionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return false
  }

  try {
    const result = await redis.exists(`${EXECUTION_CANCEL_PREFIX}${executionId}`)
    return result === 1
  } catch (error) {
    logger.error('Failed to check execution cancellation', { executionId, error })
    return false
  }
}

/**
 * Clear the cancellation flag for an execution.
 */
export async function clearExecutionCancellation(executionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    await redis.del(`${EXECUTION_CANCEL_PREFIX}${executionId}`)
  } catch (error) {
    logger.error('Failed to clear execution cancellation', { executionId, error })
  }
}
