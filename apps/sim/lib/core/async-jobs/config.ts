import { createLogger } from '@sim/logger'
import type { AsyncBackendType, JobQueueBackend } from '@/lib/core/async-jobs/types'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('AsyncJobsConfig')

let cachedBackend: JobQueueBackend | null = null
let cachedBackendType: AsyncBackendType | null = null

/**
 * Determines which async backend to use based on environment configuration.
 * Follows the fallback chain: trigger.dev → redis → database
 */
export function getAsyncBackendType(): AsyncBackendType {
  if (isTriggerDevEnabled) {
    return 'trigger-dev'
  }

  const redis = getRedisClient()
  if (redis) {
    return 'redis'
  }

  return 'database'
}

/**
 * Gets the job queue backend singleton.
 * Creates the appropriate backend based on environment configuration.
 */
export async function getJobQueue(): Promise<JobQueueBackend> {
  if (cachedBackend) {
    return cachedBackend
  }

  const type = getAsyncBackendType()

  switch (type) {
    case 'trigger-dev': {
      const { TriggerDevJobQueue } = await import('@/lib/core/async-jobs/backends/trigger-dev')
      cachedBackend = new TriggerDevJobQueue()
      break
    }
    case 'redis': {
      const redis = getRedisClient()
      if (!redis) {
        throw new Error('Redis client not available but redis backend was selected')
      }
      const { RedisJobQueue } = await import('@/lib/core/async-jobs/backends/redis')
      cachedBackend = new RedisJobQueue(redis)
      break
    }
    case 'database': {
      const { DatabaseJobQueue } = await import('@/lib/core/async-jobs/backends/database')
      cachedBackend = new DatabaseJobQueue()
      break
    }
  }

  cachedBackendType = type
  logger.info(`Async job backend initialized: ${type}`)

  return cachedBackend
}

/**
 * Gets the current backend type (for logging/debugging)
 */
export function getCurrentBackendType(): AsyncBackendType | null {
  return cachedBackendType
}

/**
 * Checks if jobs should be executed inline (fire-and-forget).
 * For Redis/DB backends, we execute inline. Trigger.dev handles execution itself.
 */
export function shouldExecuteInline(): boolean {
  return getAsyncBackendType() !== 'trigger-dev'
}

/**
 * Resets the cached backend (useful for testing)
 */
export function resetJobQueueCache(): void {
  cachedBackend = null
  cachedBackendType = null
}
