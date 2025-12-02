import { db } from '@sim/db'
import {
  workflow,
  workflowExecutionLogs,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { and, desc, eq, gte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import {
  executeNotificationDelivery,
  workspaceNotificationDeliveryTask,
} from '@/background/workspace-notification-delivery'

const logger = createLogger('LogsEventEmitter')

/** Cooldown period between alerts for the same subscription (in hours) */
const ALERT_COOLDOWN_HOURS = 1

/** Minimum executions required before failure rate alert can trigger */
const MIN_EXECUTIONS_FOR_RATE_ALERT = 5

interface AlertConfig {
  rule: 'consecutive_failures' | 'failure_rate'
  consecutiveFailures?: number
  failureRatePercent?: number
  windowHours?: number
}

/**
 * Checks if a subscription is within its cooldown period
 */
function isInCooldown(lastAlertAt: Date | null): boolean {
  if (!lastAlertAt) return false
  const cooldownEnd = new Date(lastAlertAt.getTime() + ALERT_COOLDOWN_HOURS * 60 * 60 * 1000)
  return new Date() < cooldownEnd
}

/**
 * Checks if consecutive failures threshold is met for a workflow
 */
async function checkConsecutiveFailures(workflowId: string, threshold: number): Promise<boolean> {
  const recentLogs = await db
    .select({ level: workflowExecutionLogs.level })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
    .orderBy(desc(workflowExecutionLogs.createdAt))
    .limit(threshold)

  if (recentLogs.length < threshold) return false

  return recentLogs.every((log) => log.level === 'error')
}

/**
 * Checks if failure rate threshold is met for a workflow within the time window.
 * Only triggers after the workflow has data spanning the full window period.
 */
async function checkFailureRate(
  workflowId: string,
  ratePercent: number,
  windowHours: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const oldestLog = await db
    .select({ createdAt: workflowExecutionLogs.createdAt })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, workflowId))
    .orderBy(workflowExecutionLogs.createdAt)
    .limit(1)

  if (!oldestLog[0] || oldestLog[0].createdAt > windowStart) {
    return false
  }

  const logs = await db
    .select({ level: workflowExecutionLogs.level })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.createdAt, windowStart)
      )
    )

  if (logs.length < MIN_EXECUTIONS_FOR_RATE_ALERT) return false

  const errorCount = logs.filter((log) => log.level === 'error').length
  const actualRate = (errorCount / logs.length) * 100

  return actualRate >= ratePercent
}

/**
 * Evaluates if an alert should be triggered based on the subscription's alert config
 */
async function shouldTriggerAlert(
  subscription: { alertConfig: unknown; lastAlertAt: Date | null },
  workflowId: string
): Promise<boolean> {
  const alertConfig = subscription.alertConfig as AlertConfig | null
  if (!alertConfig) return false

  if (isInCooldown(subscription.lastAlertAt)) {
    logger.debug(`Subscription in cooldown, skipping alert check`)
    return false
  }

  if (alertConfig.rule === 'consecutive_failures' && alertConfig.consecutiveFailures) {
    return checkConsecutiveFailures(workflowId, alertConfig.consecutiveFailures)
  }

  if (
    alertConfig.rule === 'failure_rate' &&
    alertConfig.failureRatePercent &&
    alertConfig.windowHours
  ) {
    return checkFailureRate(workflowId, alertConfig.failureRatePercent, alertConfig.windowHours)
  }

  return false
}

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

      const hasAlertConfig = !!subscription.alertConfig

      if (hasAlertConfig) {
        const shouldAlert = await shouldTriggerAlert(subscription, log.workflowId)
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
          alertConfig: subscription.alertConfig,
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
