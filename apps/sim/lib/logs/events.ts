import { db } from '@sim/db'
import {
  workflow,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import {
  type AlertCheckContext,
  type AlertConfig,
  shouldTriggerAlert,
} from '@/lib/notifications/alert-rules'
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
  }
) {
  const preparedLog = { ...log, executionData: {} as Record<string, unknown> }

  if (log.executionData) {
    const data = log.executionData as Record<string, unknown>
    const webhookData: Record<string, unknown> = {}

    if (subscription.includeFinalOutput && data.finalOutput) {
      webhookData.finalOutput = data.finalOutput
    }

    if (subscription.includeTraceSpans && data.traceSpans) {
      webhookData.traceSpans = data.traceSpans
    }

    preparedLog.executionData = webhookData
  }

  return preparedLog
}

export async function emitWorkflowExecutionCompleted(log: WorkflowExecutionLog): Promise<void> {
  try {
    if (!log.workflowId) return

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
      const levelMatches = subscription.levelFilter.includes(log.level)
      const triggerMatches = subscription.triggerFilter.includes(log.trigger)

      if (!levelMatches || !triggerMatches) {
        logger.debug(`Skipping subscription ${subscription.id} due to filter mismatch`)
        continue
      }

      const alertConfig = subscription.alertConfig as AlertConfig | null

      if (alertConfig) {
        const context: AlertCheckContext = {
          workflowId: log.workflowId,
          executionId: log.executionId,
          status: log.level === 'error' ? 'error' : 'success',
          durationMs: log.totalDurationMs || 0,
          cost: (log.cost as { total?: number })?.total || 0,
          triggerFilter: subscription.triggerFilter,
        }

        const shouldAlert = await shouldTriggerAlert(alertConfig, context, subscription.lastAlertAt)

        if (!shouldAlert) {
          logger.debug(`Alert condition not met for subscription ${subscription.id}`)
          continue
        }

        await db
          .update(workspaceNotificationSubscription)
          .set({ lastAlertAt: new Date() })
          .where(eq(workspaceNotificationSubscription.id, subscription.id))

        logger.info(`Alert triggered for subscription ${subscription.id}`, {
          workflowId: log.workflowId,
          alertConfig,
        })
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
        alertConfig: alertConfig || undefined,
      }

      if (isTriggerDevEnabled) {
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
