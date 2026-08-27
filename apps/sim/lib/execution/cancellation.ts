import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import {
  getExecutionSignalChannel,
  getExecutionSignalHub,
  LEGACY_EXECUTION_CANCEL_CHANNEL,
  publishLocalExecutionSignal,
} from '@/lib/execution/execution-signal'

const logger = createLogger('ExecutionCancellation')

const EXECUTION_CANCEL_PREFIX = 'execution:cancel:'
export const EXECUTION_CANCEL_MIN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_LOCAL_CANCELLATION_RECORDS = 50_000
const localCancelledExecutions = new Map<string, number>()
let localCancellationCleanupTimer: NodeJS.Timeout | undefined
let localCancellationCleanupAt: number | undefined
const MARK_EXECUTION_CANCELLED_SCRIPT = `
redis.call('SET', KEYS[1], '1', 'PXAT', ARGV[1])
redis.call('PUBLISH', ARGV[2], 'cancelled')
redis.call('PUBLISH', ARGV[3], ARGV[4])
return 1
`

export interface MarkExecutionCancelledOptions {
  executionDeadlineAt?: Date | null
}

export type ExecutionCancellationRecordResult =
  | { durablyRecorded: true; reason: 'recorded' }
  | {
      durablyRecorded: false
      reason: 'redis_unavailable' | 'redis_write_failed'
    }

function getCancellationExpiryAt(options: MarkExecutionCancelledOptions): number {
  const minimumExpiryAt = Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS
  const deadlineExpiryAt = options.executionDeadlineAt?.getTime()
  return deadlineExpiryAt !== undefined && Number.isFinite(deadlineExpiryAt)
    ? Math.max(minimumExpiryAt, deadlineExpiryAt)
    : minimumExpiryAt
}

function serializeLegacyCancellationSignal(
  executionId: string,
  executionSignalPublished: boolean
): string {
  return JSON.stringify(
    executionSignalPublished ? { executionId, executionSignalPublished: true } : { executionId }
  )
}

async function publishCancellationSignalBestEffort(
  redis: NonNullable<ReturnType<typeof getRedisClient>>,
  executionId: string
): Promise<void> {
  let executionSignalPublished = false
  try {
    await redis.publish(getExecutionSignalChannel(executionId), 'cancelled')
    executionSignalPublished = true
  } catch (error) {
    logger.warn('Failed to publish best-effort execution cancellation signal', {
      executionId,
      error,
    })
  }

  try {
    await redis.publish(
      LEGACY_EXECUTION_CANCEL_CHANNEL,
      serializeLegacyCancellationSignal(executionId, executionSignalPublished)
    )
  } catch (error) {
    logger.warn('Failed to publish best-effort legacy execution cancellation signal', {
      executionId,
      error,
    })
  }
}

function scheduleLocalCancellationCleanup(candidateExpiryAt?: number): void {
  if (
    candidateExpiryAt !== undefined &&
    localCancellationCleanupTimer &&
    localCancellationCleanupAt !== undefined &&
    localCancellationCleanupAt <= candidateExpiryAt
  ) {
    return
  }
  if (localCancellationCleanupTimer) clearTimeout(localCancellationCleanupTimer)
  localCancellationCleanupTimer = undefined
  localCancellationCleanupAt = undefined
  if (localCancelledExecutions.size === 0) return

  const now = Date.now()
  let nextExpiryAt = candidateExpiryAt
  if (nextExpiryAt === undefined) {
    nextExpiryAt = Number.POSITIVE_INFINITY
    for (const expiryAt of localCancelledExecutions.values()) {
      nextExpiryAt = Math.min(nextExpiryAt, expiryAt)
    }
  }
  const delayMs = Math.min(Math.max(0, nextExpiryAt - now), MAX_TIMER_DELAY_MS)
  localCancellationCleanupAt = now + delayMs
  localCancellationCleanupTimer = setTimeout(() => {
    localCancellationCleanupTimer = undefined
    localCancellationCleanupAt = undefined
    const cleanupAt = Date.now()
    for (const [executionId, expiryAt] of localCancelledExecutions) {
      if (expiryAt <= cleanupAt) localCancelledExecutions.delete(executionId)
    }
    scheduleLocalCancellationCleanup()
  }, delayMs)
  localCancellationCleanupTimer.unref?.()
}

/** Writes the durable key first, then publishes — so a late subscriber still sees the flag on backstop check. */
export async function markExecutionCancelled(
  executionId: string,
  options: MarkExecutionCancelledOptions = {}
): Promise<ExecutionCancellationRecordResult> {
  const redis = getRedisClient()
  const expiryAt = getCancellationExpiryAt(options)
  if (!redis) {
    if (!localCancelledExecutions.has(executionId)) {
      const oldestExecutionId = localCancelledExecutions.keys().next().value
      if (
        localCancelledExecutions.size >= MAX_LOCAL_CANCELLATION_RECORDS &&
        oldestExecutionId !== undefined
      ) {
        localCancelledExecutions.delete(oldestExecutionId)
        logger.warn('Evicted oldest process-local cancellation record at capacity', {
          maxRecords: MAX_LOCAL_CANCELLATION_RECORDS,
        })
      }
    } else {
      localCancelledExecutions.delete(executionId)
    }
    localCancelledExecutions.set(executionId, expiryAt)
    scheduleLocalCancellationCleanup(expiryAt)
    try {
      publishLocalExecutionSignal(executionId, 'cancelled')
    } catch (error) {
      logger.warn('Failed to publish process-local cancellation signal', { executionId, error })
    }
    return { durablyRecorded: false, reason: 'redis_unavailable' }
  }

  try {
    await redis.eval(
      MARK_EXECUTION_CANCELLED_SCRIPT,
      1,
      `${EXECUTION_CANCEL_PREFIX}${executionId}`,
      expiryAt,
      getExecutionSignalChannel(executionId),
      LEGACY_EXECUTION_CANCEL_CHANNEL,
      serializeLegacyCancellationSignal(executionId, true)
    )
    logger.info('Marked execution as cancelled', {
      executionId,
      expiresAt: new Date(expiryAt).toISOString(),
    })
    return { durablyRecorded: true, reason: 'recorded' }
  } catch (error) {
    logger.error('Failed to mark execution as cancelled', { executionId, error })
    void publishCancellationSignalBestEffort(redis, executionId)
    return { durablyRecorded: false, reason: 'redis_write_failed' }
  }
}

async function readExecutionCancelledStrict(executionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    const expiryAt = localCancelledExecutions.get(executionId)
    if (expiryAt === undefined) return false
    if (expiryAt <= Date.now()) {
      localCancelledExecutions.delete(executionId)
      if (expiryAt <= (localCancellationCleanupAt ?? Number.POSITIVE_INFINITY)) {
        scheduleLocalCancellationCleanup()
      }
      return false
    }
    return true
  }
  return (await redis.exists(`${EXECUTION_CANCEL_PREFIX}${executionId}`)) === 1
}

/**
 * Subscribes before reading the durable flag, then re-reads after subscriber reconnects.
 * This closes both the initial subscribe race and a Redis disconnect gap without polling.
 */
export async function subscribeToExecutionCancellation(
  executionId: string,
  onCancelled: () => void
): Promise<() => void> {
  let disposed = false
  let readInFlight: Promise<void> | undefined
  let readAgain = false
  const readAndCancel = () => {
    if (disposed) return undefined
    if (readInFlight) {
      readAgain = true
      return readInFlight
    }
    readInFlight = (async () => {
      do {
        readAgain = false
        const cancelled = await readExecutionCancelledStrict(executionId)
        if (cancelled && !disposed) onCancelled()
      } while (readAgain && !disposed)
    })().finally(() => {
      readInFlight = undefined
    })
    return readInFlight
  }

  const unsubscribe = await getExecutionSignalHub().subscribe(executionId, (reason) => {
    if (reason === 'cancelled') {
      onCancelled()
      return
    }
    if (reason === 'unavailable') {
      logger.error('Execution cancellation signal became unavailable', { executionId })
      onCancelled()
      return
    }
    if (reason === 'reconnected') {
      void readAndCancel()?.catch((error) => {
        logger.error('Failed to restore cancellation state after signal reconnect', {
          executionId,
          error,
        })
        if (!disposed) onCancelled()
      })
    }
  })
  try {
    await readAndCancel()
  } catch (error) {
    unsubscribe()
    throw error
  }
  return () => {
    disposed = true
    unsubscribe()
  }
}

export async function clearExecutionCancellation(executionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    const expiryAt = localCancelledExecutions.get(executionId)
    localCancelledExecutions.delete(executionId)
    if (
      expiryAt !== undefined &&
      expiryAt <= (localCancellationCleanupAt ?? Number.POSITIVE_INFINITY)
    ) {
      scheduleLocalCancellationCleanup()
    }
    return
  }

  try {
    await redis.del(`${EXECUTION_CANCEL_PREFIX}${executionId}`)
  } catch (error) {
    logger.error('Failed to clear execution cancellation', { executionId, error })
  }
}
