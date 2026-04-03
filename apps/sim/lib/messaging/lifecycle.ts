import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('LifecycleEmail')

export const LIFECYCLE_EMAIL_TASK_ID = 'lifecycle-email' as const

/** Supported lifecycle email types. Add new types here as the sequence grows. */
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
  if (!isTriggerDevEnabled || !env.TRIGGER_SECRET_KEY) {
    logger.info('[lifecycle] Trigger.dev not configured, skipping lifecycle email', {
      userId,
      type,
    })
    return
  }

  const delayUntil = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)

  await tasks.trigger(
    LIFECYCLE_EMAIL_TASK_ID,
    { userId, type },
    {
      delay: delayUntil,
      idempotencyKey: `lifecycle-${type}-${userId}`,
    }
  )

  logger.info('[lifecycle] Scheduled lifecycle email', { userId, type, delayDays })
}
