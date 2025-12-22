/**
 * Internal Scheduler for Self-Hosted Environments
 *
 * This module provides a built-in scheduler that periodically polls the
 * /api/schedules/execute endpoint to trigger scheduled workflows.
 * This is necessary for self-hosted environments that don't have access
 * to external cron services like Vercel Cron Jobs.
 *
 * Enable by setting ENABLE_INTERNAL_SCHEDULER=true in your environment.
 */

import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('InternalScheduler')

const DEFAULT_POLL_INTERVAL_MS = 60000 // 1 minute

let schedulerInterval: ReturnType<typeof setInterval> | null = null
let isRunning = false

/**
 * Execute the schedule poll
 */
async function pollSchedules(): Promise<void> {
  if (isRunning) {
    logger.debug('Previous poll still running, skipping this cycle')
    return
  }

  isRunning = true

  try {
    const appUrl = env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL || 'http://localhost:3000'
    const cronSecret = env.CRON_SECRET

    if (!cronSecret) {
      logger.warn('CRON_SECRET not configured, internal scheduler cannot authenticate')
      return
    }

    const response = await fetch(`${appUrl}/api/schedules/execute`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'User-Agent': 'sim-studio-internal-scheduler/1.0',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Schedule poll failed', {
        status: response.status,
        error: errorText,
      })
      return
    }

    const result = await response.json()
    if (result.executedCount > 0) {
      logger.info(`Triggered ${result.executedCount} scheduled workflow(s)`)
    }
  } catch (error) {
    logger.error('Error during schedule poll', error)
  } finally {
    isRunning = false
  }
}

/**
 * Start the internal scheduler
 */
export function startInternalScheduler(): void {
  if (schedulerInterval) {
    logger.warn('Internal scheduler already running')
    return
  }

  const pollInterval = Number(env.INTERNAL_SCHEDULER_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS

  logger.info(`Starting internal scheduler with poll interval: ${pollInterval}ms`)

  // Run immediately on start
  void pollSchedules()

  // Then run at regular intervals
  schedulerInterval = setInterval(() => {
    void pollSchedules()
  }, pollInterval)
}

/**
 * Stop the internal scheduler
 */
export function stopInternalScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('Internal scheduler stopped')
  }
}

/**
 * Check if the internal scheduler should be enabled
 */
export function shouldEnableInternalScheduler(): boolean {
  return env.ENABLE_INTERNAL_SCHEDULER === 'true'
}

/**
 * Initialize the internal scheduler if enabled
 */
export function initializeInternalScheduler(): void {
  if (!shouldEnableInternalScheduler()) {
    logger.debug('Internal scheduler disabled (set ENABLE_INTERNAL_SCHEDULER=true to enable)')
    return
  }

  if (!env.CRON_SECRET) {
    logger.warn('Cannot start internal scheduler: CRON_SECRET is not configured')
    return
  }

  startInternalScheduler()

  // Graceful shutdown handlers
  process.on('SIGTERM', () => {
    stopInternalScheduler()
  })

  process.on('SIGINT', () => {
    stopInternalScheduler()
  })
}
