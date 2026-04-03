import { createLogger } from '@sim/logger'
import type { AsyncBackendType, JobQueueBackend } from '@/lib/core/async-jobs/types'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('AsyncJobsConfig')

let cachedBackend: JobQueueBackend | null = null

/**
 * Determines which async backend to use based on environment configuration.
 * Fallback chain: trigger.dev -> database
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

  logger.info(`Async job backend initialized: ${type}`)

  if (!cachedBackend) {
    throw new Error(`Failed to initialize async backend: ${type}`)
  }

  return cachedBackend
}

/**
 * Gets a job queue backend that bypasses Trigger.dev (database only).
 * Used for execution paths that must avoid Trigger.dev cold starts.
 */
export async function getInlineJobQueue(): Promise<JobQueueBackend> {
  const { DatabaseJobQueue } = await import('@/lib/core/async-jobs/backends/database')
  return new DatabaseJobQueue()
}

/**
 * Checks if jobs should be executed inline in-process.
 * Database fallback is the only mode that still relies on inline execution.
 */
export function shouldExecuteInline(): boolean {
  return getAsyncBackendType() === 'database'
}
