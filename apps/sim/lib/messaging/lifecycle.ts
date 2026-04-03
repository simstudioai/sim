import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'

const logger = createLogger('LifecycleEmail')

/** Supported lifecycle email types. Must stay in sync with background/lifecycle-email.ts. */
export type LifecycleEmailType = 'onboarding-followup'

interface ScheduleLifecycleEmailOptions {
  userId: string
  type: LifecycleEmailType
  delayDays: number
}

/**
 * Schedules a lifecycle email to be sent after a delay.
 * Uses Trigger.dev's built-in delay scheduling — no polling or cron needed.
 */
export async function scheduleLifecycleEmail({
  userId,
  type,
  delayDays,
}: ScheduleLifecycleEmailOptions): Promise<void> {
  const delayUntil = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)

  await tasks.trigger('lifecycle-email', { userId, type }, { delay: delayUntil })

  logger.info('[lifecycle] Scheduled lifecycle email', { userId, type, delayDays })
}
