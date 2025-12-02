import { db } from '@sim/db'
import {
  workflow,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { and, eq, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import {
  executeNotificationDelivery,
  workspaceNotificationDeliveryTask,
} from '@/background/workspace-notification-delivery'

const logger = createLogger('LogsEventEmitter')

function prepareLogData(
  log: WorkflowExecutionLog,
  subscription: {
    includeFinalOutput: boolean
    includeTraceSpans: boolean
    includeRateLimits: boolean
    includeUsageData: boolean
  }
) {
  const preparedLog = { ...log, executionData: {} }

  if (log.executionData) {
    const data = log.executionData as Record<string, unknown>
    const webhookData: Record<string, unknown> = {}

    if (subscription.includeFinalOutput && data.finalOutput) {
      webhookData.finalOutput = data.finalOutput
    }

    if (subscription.includeTraceSpans && data.traceSpans) {
      webhookData.traceSpans = data.traceSpans
    }

    if (subscription.includeRateLimits) {
      webhookData.includeRateLimits = true
    }

    if (subscription.includeUsageData) {
      webhookData.includeUsageData = true
    }

    preparedLog.executionData = webhookData
  }

  return preparedLog
}

export async function emitWorkflowExecutionCompleted(log: WorkflowExecutionLog): Promise<void> {
  try {
    const workflowData = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, log.workflowId))
      .limit(1)

    if (workflowData.length === 0 || !workflowData[0].workspaceId) return

    const workspaceId = workflowData[0].workspaceId

    const subscriptions = await db
      .select()
      .from(workspaceNotificationSubscription)
      .where(
        and(
          eq(workspaceNotificationSubscription.workspaceId, workspaceId),
          eq(workspaceNotificationSubscription.active, true),
          or(
            eq(workspaceNotificationSubscription.allWorkflows, true),
            sql`${log.workflowId} = ANY(${workspaceNotificationSubscription.workflowIds})`
          )
        )
      )

    if (subscriptions.length === 0) return

    logger.debug(
      `Found ${subscriptions.length} active notification subscriptions for workspace ${workspaceId}`
    )

    for (const subscription of subscriptions) {
      const levelMatches = subscription.levelFilter?.includes(log.level) ?? true
      const triggerMatches = subscription.triggerFilter?.includes(log.trigger) ?? true

      if (!levelMatches || !triggerMatches) {
        logger.debug(`Skipping subscription ${subscription.id} due to filter mismatch`)
        continue
      }

      const deliveryId = uuidv4()

      await db.insert(workspaceNotificationDelivery).values({
        id: deliveryId,
        subscriptionId: subscription.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })

      const notificationLog = prepareLogData(log, subscription)

      const payload = {
        deliveryId,
        subscriptionId: subscription.id,
        notificationType: subscription.notificationType,
        log: notificationLog,
      }

      const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

      if (useTrigger) {
        await workspaceNotificationDeliveryTask.trigger(payload)
        logger.info(
          `Enqueued ${subscription.notificationType} notification ${deliveryId} via Trigger.dev`
        )
      } else {
        void executeNotificationDelivery(payload).catch((error) => {
          logger.error(`Direct notification delivery failed for ${deliveryId}`, { error })
        })
        logger.info(`Enqueued ${subscription.notificationType} notification ${deliveryId} directly`)
      }
    }
  } catch (error) {
    logger.error('Failed to emit workflow execution completed event', {
      error,
      workflowId: log.workflowId,
      executionId: log.executionId,
    })
  }
}
