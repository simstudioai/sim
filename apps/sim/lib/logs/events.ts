import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { logsWebhookDelivery } from '@/background/logs-webhook-delivery'
import { db } from '@/db'
import { workflowLogWebhook, workflowLogWebhookDelivery } from '@/db/schema'

const logger = createLogger('LogsEventEmitter')

export async function emitWorkflowExecutionCompleted(log: WorkflowExecutionLog): Promise<void> {
  try {
    const subscriptions = await db
      .select()
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.workflowId, log.workflowId), eq(workflowLogWebhook.active, true))
      )

    if (subscriptions.length === 0) {
      return
    }

    logger.debug(
      `Found ${subscriptions.length} active webhook subscriptions for workflow ${log.workflowId}`
    )

    for (const subscription of subscriptions) {
      const levelMatches = subscription.levelFilter?.includes(log.level) ?? true
      const triggerMatches = subscription.triggerFilter?.includes(log.trigger) ?? true

      if (!levelMatches || !triggerMatches) {
        logger.debug(`Skipping subscription ${subscription.id} due to filter mismatch`, {
          level: log.level,
          trigger: log.trigger,
          levelFilter: subscription.levelFilter,
          triggerFilter: subscription.triggerFilter,
        })
        continue
      }

      const deliveryId = uuidv4()

      await db.insert(workflowLogWebhookDelivery).values({
        id: deliveryId,
        subscriptionId: subscription.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })

      // Prepare the log data based on subscription settings
      const webhookLog = {
        ...log,
        executionData: {},
      }

      // Only include executionData fields that are requested
      if (log.executionData) {
        const data = log.executionData as any
        const webhookData: any = {}

        if (subscription.includeFinalOutput && data.finalOutput) {
          webhookData.finalOutput = data.finalOutput
        }

        if (subscription.includeTraceSpans && data.traceSpans) {
          webhookData.traceSpans = data.traceSpans
        }

        // For rate limits and usage, we'll need to fetch them in the webhook delivery
        // since they're user-specific and may change
        if (subscription.includeRateLimits) {
          webhookData.includeRateLimits = true
        }

        if (subscription.includeUsageData) {
          webhookData.includeUsageData = true
        }

        webhookLog.executionData = webhookData
      }

      await logsWebhookDelivery.trigger({
        deliveryId,
        subscriptionId: subscription.id,
        log: webhookLog,
      })

      logger.info(`Enqueued webhook delivery ${deliveryId} for subscription ${subscription.id}`)
    }
  } catch (error) {
    logger.error('Failed to emit workflow execution completed event', {
      error,
      workflowId: log.workflowId,
      executionId: log.executionId,
    })
  }
}
