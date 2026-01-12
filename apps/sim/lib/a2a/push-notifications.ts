/**
 * A2A Push Notifications
 *
 * Handles push notification delivery for A2A task state changes.
 * Uses trigger.dev for durable delivery when available, falls back to inline delivery.
 */

import type { Artifact, Message, TaskState } from '@a2a-js/sdk'
import { db } from '@sim/db'
import { a2aPushNotificationConfig, a2aTask } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('A2APushNotifications')

/**
 * Deliver push notification for a task state change.
 * Works without any external dependencies (DB-only).
 */
export async function deliverPushNotification(taskId: string, state: TaskState): Promise<boolean> {
  // Get push notification config
  const [config] = await db
    .select()
    .from(a2aPushNotificationConfig)
    .where(eq(a2aPushNotificationConfig.taskId, taskId))
    .limit(1)

  if (!config || !config.isActive) {
    // No config = nothing to deliver (success)
    return true
  }

  // Get task data
  const [task] = await db.select().from(a2aTask).where(eq(a2aTask.id, taskId)).limit(1)

  if (!task) {
    logger.warn('Task not found for push notification', { taskId })
    return false
  }

  const timestamp = new Date().toISOString()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'task-update',
        task: {
          kind: 'task',
          id: task.id,
          contextId: task.sessionId,
          status: { state, timestamp },
          history: task.messages as Message[],
          artifacts: (task.artifacts as Artifact[]) || [],
        },
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      logger.error('Push notification delivery failed', {
        taskId,
        url: config.url,
        status: response.status,
      })
      return false
    }

    logger.info('Push notification delivered successfully', { taskId, state })
    return true
  } catch (error) {
    logger.error('Push notification delivery error', { taskId, error })
    return false
  }
}

/**
 * Notify task state change.
 * Uses trigger.dev for durable delivery when available, falls back to inline delivery.
 */
export async function notifyTaskStateChange(taskId: string, state: TaskState): Promise<void> {
  // First check if there's even a push notification config for this task
  const [config] = await db
    .select({ id: a2aPushNotificationConfig.id })
    .from(a2aPushNotificationConfig)
    .where(eq(a2aPushNotificationConfig.taskId, taskId))
    .limit(1)

  if (!config) {
    // No push notification configured, skip
    return
  }

  if (isTriggerDevEnabled) {
    try {
      // Dynamic import to avoid loading trigger.dev when not configured
      const { a2aPushNotificationTask } = await import(
        '@/background/a2a-push-notification-delivery'
      )
      await a2aPushNotificationTask.trigger({ taskId, state })
      logger.info('Push notification queued to trigger.dev', { taskId, state })
    } catch (error) {
      // If trigger.dev fails, fall back to inline delivery
      logger.warn('Failed to queue push notification, falling back to inline delivery', {
        taskId,
        error,
      })
      await deliverPushNotification(taskId, state)
    }
  } else {
    // Inline delivery (best-effort, no retries)
    await deliverPushNotification(taskId, state)
  }
}
