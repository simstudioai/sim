import { db } from '@sim/db'
import {
  workflow,
  workflowExecutionLogs,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  executeNotificationDelivery,
  workspaceNotificationDeliveryTask,
} from '@/background/workspace-notification-delivery'
import type { AlertConfig } from './alert-rules'
import { isInCooldown } from './alert-rules'

const logger = createLogger('InactivityPolling')

interface InactivityCheckResult {
  subscriptionId: string
  workflowId: string
  triggered: boolean
  reason?: string
}

/**
 * Checks a single workflow for inactivity and triggers notification if needed
 */
async function checkWorkflowInactivity(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  workflowId: string,
  alertConfig: AlertConfig
): Promise<InactivityCheckResult> {
  const result: InactivityCheckResult = {
    subscriptionId: subscription.id,
    workflowId,
    triggered: false,
  }

  if (isInCooldown(subscription.lastAlertAt)) {
    result.reason = 'in_cooldown'
    return result
  }

  const windowStart = new Date(Date.now() - (alertConfig.inactivityHours || 24) * 60 * 60 * 1000)

  const recentLogs = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.createdAt, windowStart)
      )
    )
    .limit(1)

  if (recentLogs.length > 0) {
    result.reason = 'has_activity'
    return result
  }

  const [workflowData] = await db
    .select({
      name: workflow.name,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowData || !workflowData.workspaceId) {
    result.reason = 'workflow_not_found'
    return result
  }

  await db
    .update(workspaceNotificationSubscription)
    .set({ lastAlertAt: new Date() })
    .where(eq(workspaceNotificationSubscription.id, subscription.id))

  const deliveryId = uuidv4()

  await db.insert(workspaceNotificationDelivery).values({
    id: deliveryId,
    subscriptionId: subscription.id,
    workflowId,
    executionId: `inactivity_${Date.now()}`,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(),
  })

  const now = new Date().toISOString()
  const mockLog = {
    id: `inactivity_log_${uuidv4()}`,
    workflowId,
    executionId: `inactivity_${Date.now()}`,
    stateSnapshotId: '',
    level: 'info' as const,
    trigger: 'system' as const,
    startedAt: now,
    endedAt: now,
    totalDurationMs: 0,
    executionData: {},
    cost: { total: 0 },
    workspaceId: workflowData.workspaceId,
    createdAt: now,
  }

  const payload = {
    deliveryId,
    subscriptionId: subscription.id,
    notificationType: subscription.notificationType,
    log: mockLog,
    alertConfig,
  }

  const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

  if (useTrigger) {
    await workspaceNotificationDeliveryTask.trigger(payload)
  } else {
    void executeNotificationDelivery(payload).catch((error) => {
      logger.error(`Direct notification delivery failed for ${deliveryId}`, { error })
    })
  }

  result.triggered = true
  result.reason = 'alert_sent'

  logger.info(`Inactivity alert triggered for workflow ${workflowId}`, {
    subscriptionId: subscription.id,
    inactivityHours: alertConfig.inactivityHours,
  })

  return result
}

/**
 * Polls all active no_activity subscriptions and triggers alerts as needed
 */
export async function pollInactivityAlerts(): Promise<{
  total: number
  triggered: number
  skipped: number
  details: InactivityCheckResult[]
}> {
  logger.info('Starting inactivity alert polling')

  const subscriptions = await db
    .select()
    .from(workspaceNotificationSubscription)
    .where(
      and(
        eq(workspaceNotificationSubscription.active, true),
        sql`${workspaceNotificationSubscription.alertConfig}->>'rule' = 'no_activity'`
      )
    )

  if (subscriptions.length === 0) {
    logger.info('No active no_activity subscriptions found')
    return { total: 0, triggered: 0, skipped: 0, details: [] }
  }

  logger.info(`Found ${subscriptions.length} no_activity subscriptions to check`)

  const results: InactivityCheckResult[] = []
  let triggered = 0
  let skipped = 0

  for (const subscription of subscriptions) {
    const alertConfig = subscription.alertConfig as AlertConfig
    if (!alertConfig || alertConfig.rule !== 'no_activity') {
      continue
    }

    let workflowIds: string[] = []

    if (subscription.allWorkflows) {
      const workflows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, subscription.workspaceId))

      workflowIds = workflows.map((w) => w.id)
    } else {
      workflowIds = subscription.workflowIds || []
    }

    for (const workflowId of workflowIds) {
      const result = await checkWorkflowInactivity(subscription, workflowId, alertConfig)
      results.push(result)

      if (result.triggered) {
        triggered++
      } else {
        skipped++
      }
    }
  }

  logger.info(`Inactivity polling completed: ${triggered} alerts triggered, ${skipped} skipped`)

  return {
    total: results.length,
    triggered,
    skipped,
    details: results,
  }
}
