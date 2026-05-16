import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('ExecutionCancellation')

const EXECUTION_CANCEL_PREFIX = 'execution:cancel:'
const EXECUTION_CANCEL_EXPIRY = 60 * 60
const EXECUTION_CANCEL_CHANNEL = 'execution:cancel'

export interface ExecutionCancelEvent {
  executionId: string
}

export type ExecutionCancellationRecordResult =
  | { durablyRecorded: true; reason: 'recorded' }
  | {
      durablyRecorded: false
      reason: 'redis_unavailable' | 'redis_write_failed'
    }

let sharedChannel: PubSubChannel<ExecutionCancelEvent> | null = null

export function getCancellationChannel(): PubSubChannel<ExecutionCancelEvent> {
  if (!sharedChannel) {
    sharedChannel = createPubSubChannel<ExecutionCancelEvent>({
      channel: EXECUTION_CANCEL_CHANNEL,
      label: 'execution-cancel',
    })
  }
  return sharedChannel
}

export function isRedisCancellationEnabled(): boolean {
  return getRedisClient() !== null
}

/** Writes the durable key first, then publishes — so a late subscriber still sees the flag on backstop check. */
export async function markExecutionCancelled(
  executionId: string
): Promise<ExecutionCancellationRecordResult> {
  const redis = getRedisClient()
  if (!redis) {
    getCancellationChannel().publish({ executionId })
    return { durablyRecorded: false, reason: 'redis_unavailable' }
  }

  try {
    await redis.set(`${EXECUTION_CANCEL_PREFIX}${executionId}`, '1', 'EX', EXECUTION_CANCEL_EXPIRY)
    logger.info('Marked execution as cancelled', { executionId })
    getCancellationChannel().publish({ executionId })
    return { durablyRecorded: true, reason: 'recorded' }
  } catch (error) {
    logger.error('Failed to mark execution as cancelled', { executionId, error })
    getCancellationChannel().publish({ executionId })
    return { durablyRecorded: false, reason: 'redis_write_failed' }
  }
}

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
