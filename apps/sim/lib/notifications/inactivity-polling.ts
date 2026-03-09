import { db } from '@sim/db'
import {
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers/triggers'
import {
  executeNotificationDelivery,
  workspaceNotificationDeliveryTask,
} from '@/background/workspace-notification-delivery'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { AlertConfig } from './alert-rules'
import { isInCooldown } from './alert-rules'

const logger = createLogger('InactivityPolling')

const SCHEDULE_BLOCK_TYPES: string[] = [TRIGGER_TYPES.SCHEDULE]
const WEBHOOK_BLOCK_TYPES: string[] = [TRIGGER_TYPES.WEBHOOK, TRIGGER_TYPES.GENERIC_WEBHOOK]

function deploymentHasTriggerType(
  deploymentState: Pick<WorkflowState, 'blocks'>,
  triggerFilter: string[]
): boolean {
  const blocks = deploymentState.blocks
  if (!blocks) return false

  const alwaysAvailable = ['api', 'manual', 'chat']
  if (triggerFilter.some((t) => alwaysAvailable.includes(t))) {
    return true
  }

  for (const block of Object.values(blocks)) {
    if (triggerFilter.includes('schedule') && SCHEDULE_BLOCK_TYPES.includes(block.type)) {
      return true
    }

    if (triggerFilter.includes('webhook')) {
      if (WEBHOOK_BLOCK_TYPES.includes(block.type)) {
        return true
      }
      if (block.triggerMode === true) {
        return true
      }
    }
  }

  return false
}

async function getWorkflowsWithTriggerTypes(
  workspaceId: string,
  triggerFilter: string[]
): Promise<Set<string>> {
  const workflowIds = new Set<string>()

  const deployedWorkflows = await db
    .select({
      workflowId: workflow.id,
      deploymentState: workflowDeploymentVersion.state,
    })
    .from(workflow)
    .innerJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(and(eq(workflow.workspaceId, workspaceId), eq(workflow.isDeployed, true)))

  for (const w of deployedWorkflows) {
    const state = w.deploymentState as WorkflowState | null
    if (state && deploymentHasTriggerType(state, triggerFilter)) {
      workflowIds.add(w.workflowId)
    }
  }

  return workflowIds
}

interface InactivityCheckResult {
  subscriptionId: string
  workflowId: string
  triggered: boolean
  reason?: string
}

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
  const triggerFilter = subscription.triggerFilter
  const levelFilter = subscription.levelFilter

  const recentLogs = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.createdAt, windowStart),
        inArray(workflowExecutionLogs.trigger, triggerFilter),
        inArray(workflowExecutionLogs.level, levelFilter)
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

  if (isTriggerDevEnabled) {
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

    const triggerFilter = subscription.triggerFilter as string[]
    if (!triggerFilter || triggerFilter.length === 0) {
      logger.warn(`Subscription ${subscription.id} has no trigger filter, skipping`)
      continue
    }

    const eligibleWorkflowIds = await getWorkflowsWithTriggerTypes(
      subscription.workspaceId,
      triggerFilter
    )

    let workflowIds: string[] = []

    if (subscription.allWorkflows) {
      workflowIds = Array.from(eligibleWorkflowIds)
    } else {
      workflowIds = (subscription.workflowIds || []).filter((id) => eligibleWorkflowIds.has(id))
    }

    logger.debug(`Checking ${workflowIds.length} workflows for subscription ${subscription.id}`, {
      triggerFilter,
      eligibleCount: eligibleWorkflowIds.size,
    })

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
