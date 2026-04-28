import { createLogger } from '@sim/logger'
import type { AsyncBackendType, JobQueueBackend } from '@/lib/core/async-jobs/types'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('AsyncJobsConfig')

let cachedBackend: JobQueueBackend | null = null
let cachedBackendType: AsyncBackendType | null = null
let cachedInlineBackend: JobQueueBackend | null = null

/**
 * Determines which async backend to use based on environment configuration.
 * Follows the fallback chain: trigger.dev → database
 */
export function getAsyncBackendType(): AsyncBackendType {
  if (isTriggerDevEnabled) {
    return 'trigger-dev'
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
    case 'database': {
      const { DatabaseJobQueue } = await import('@/lib/core/async-jobs/backends/database')
      cachedBackend = new DatabaseJobQueue()
      break
    }
  }

  cachedBackendType = type
  logger.info(`Async job backend initialized: ${type}`)

  if (!cachedBackend) {
    throw new Error(`Failed to initialize async backend: ${type}`)
  }

  return cachedBackend
}

/**
 * Gets the current backend type (for logging/debugging)
 */
export function getCurrentBackendType(): AsyncBackendType | null {
  return cachedBackendType
}

/**
 * Gets a job queue backend that bypasses Trigger.dev (Database only).
 * Used for execution paths that must avoid Trigger.dev cold starts.
 */
export async function getInlineJobQueue(): Promise<JobQueueBackend> {
  if (cachedInlineBackend) {
    return cachedInlineBackend
  }

  const { DatabaseJobQueue } = await import('@/lib/core/async-jobs/backends/database')
  cachedInlineBackend = new DatabaseJobQueue()

  logger.info('Inline job backend initialized: database')
  return cachedInlineBackend
}

/**
 * Checks if jobs should be executed inline in-process.
 * Database fallback is the only mode that still relies on inline execution.
 */
export function shouldExecuteInline(): boolean {
  return getAsyncBackendType() === 'database'
}

/**
 * Resets the cached backend (useful for testing)
 */
export function resetJobQueueCache(): void {
  cachedBackend = null
  cachedBackendType = null
  cachedInlineBackend = null
}
