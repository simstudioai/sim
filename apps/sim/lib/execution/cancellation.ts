import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('ExecutionCancellation')

const EXECUTION_CANCEL_PREFIX = 'execution:cancel:'
export const EXECUTION_CANCEL_MIN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const EXECUTION_CANCEL_CHANNEL = 'execution:cancel'

export interface MarkExecutionCancelledOptions {
  executionDeadlineAt?: Date | null
}

export interface ExecutionCancelEvent {
  executionId: string
}

export type ExecutionCancellationRecordResult =
  | { durablyRecorded: true; reason: 'recorded' }
  | {
      durablyRecorded: false
      reason: 'redis_unavailable' | 'redis_write_failed'
    }

type CancellationGlobal = typeof globalThis & {
  _executionCancelChannel?: PubSubChannel<ExecutionCancelEvent>
}

const _g = globalThis as CancellationGlobal

export function getCancellationChannel(): PubSubChannel<ExecutionCancelEvent> {
  if (!_g._executionCancelChannel) {
    _g._executionCancelChannel = createPubSubChannel<ExecutionCancelEvent>({
      channel: EXECUTION_CANCEL_CHANNEL,
      label: 'execution-cancel',
    })
  }
  return _g._executionCancelChannel
}

export function isRedisCancellationEnabled(): boolean {
  return getRedisClient() !== null
}

/** Writes the durable key first, then publishes — so a late subscriber still sees the flag on backstop check. */
export async function markExecutionCancelled(
  executionId: string,
  options: MarkExecutionCancelledOptions = {}
): Promise<ExecutionCancellationRecordResult> {
  const redis = getRedisClient()
  if (!redis) {
    getCancellationChannel().publish({ executionId })
    return { durablyRecorded: false, reason: 'redis_unavailable' }
  }

  try {
    const minimumExpiryAt = Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS
    const deadlineExpiryAt = options.executionDeadlineAt?.getTime()
    const expiryAt =
      deadlineExpiryAt !== undefined && Number.isFinite(deadlineExpiryAt)
        ? Math.max(minimumExpiryAt, deadlineExpiryAt)
        : minimumExpiryAt
    await redis.set(`${EXECUTION_CANCEL_PREFIX}${executionId}`, '1', 'PXAT', expiryAt)
    logger.info('Marked execution as cancelled', {
      executionId,
      expiresAt: new Date(expiryAt).toISOString(),
    })
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
