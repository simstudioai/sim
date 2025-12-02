import { createHmac } from 'crypto'
import { db } from '@sim/db'
import {
  account,
  workflow as workflowTable,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('WorkspaceNotificationDelivery')

const MAX_ATTEMPTS = 5
const RETRY_DELAYS = [5 * 1000, 15 * 1000, 60 * 1000, 3 * 60 * 1000, 10 * 60 * 1000]

function getRetryDelayWithJitter(baseDelay: number): number {
  const jitter = Math.random() * 0.1 * baseDelay
  return Math.floor(baseDelay + jitter)
}

interface NotificationPayload {
  id: string
  type: 'workflow.execution.completed'
  timestamp: number
  data: {
    workflowId: string
    workflowName?: string
    executionId: string
    status: 'success' | 'error'
    level: string
    trigger: string
    startedAt: string
    endedAt: string
    totalDurationMs: number
    cost?: Record<string, unknown>
    finalOutput?: unknown
    traceSpans?: unknown[]
    rateLimits?: Record<string, unknown>
    usage?: Record<string, unknown>
  }
}

function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signatureBase)
  return hmac.digest('hex')
}

async function buildPayload(
  log: WorkflowExecutionLog,
  subscription: typeof workspaceNotificationSubscription.$inferSelect
): Promise<NotificationPayload> {
  const workflowData = await db
    .select({ name: workflowTable.name })
    .from(workflowTable)
    .where(eq(workflowTable.id, log.workflowId))
    .limit(1)

  const timestamp = Date.now()
  const executionData = (log.executionData || {}) as Record<string, unknown>

  const payload: NotificationPayload = {
    id: `evt_${uuidv4()}`,
    type: 'workflow.execution.completed',
    timestamp,
    data: {
      workflowId: log.workflowId,
      workflowName: workflowData[0]?.name || 'Unknown Workflow',
      executionId: log.executionId,
      status: log.level === 'error' ? 'error' : 'success',
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      totalDurationMs: log.totalDurationMs,
      cost: executionData.cost as Record<string, unknown>,
    },
  }

  if (subscription.includeFinalOutput && executionData.finalOutput) {
    payload.data.finalOutput = executionData.finalOutput
  }

  if (subscription.includeTraceSpans && executionData.traceSpans) {
    payload.data.traceSpans = executionData.traceSpans as unknown[]
  }

  if (subscription.includeRateLimits && executionData.rateLimits) {
    payload.data.rateLimits = executionData.rateLimits as Record<string, unknown>
  }

  if (subscription.includeUsageData && executionData.usage) {
    payload.data.usage = executionData.usage as Record<string, unknown>
  }

  return payload
}

async function deliverWebhook(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload
): Promise<{ success: boolean; status?: number; error?: string }> {
  if (!subscription.webhookUrl) {
    return { success: false, error: 'No webhook URL configured' }
  }

  const body = JSON.stringify(payload)
  const deliveryId = `delivery_${uuidv4()}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'sim-event': 'workflow.execution.completed',
    'sim-timestamp': payload.timestamp.toString(),
    'sim-delivery-id': deliveryId,
    'Idempotency-Key': deliveryId,
  }

  if (subscription.webhookSecret) {
    const { decrypted } = await decryptSecret(subscription.webhookSecret)
    const signature = generateSignature(decrypted, payload.timestamp, body)
    headers['sim-signature'] = `t=${payload.timestamp},v1=${signature}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(subscription.webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    return {
      success: response.ok,
      status: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    const err = error as Error & { name?: string }
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Request timeout' : err.message,
    }
  }
}

async function deliverEmail(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload
): Promise<{ success: boolean; error?: string }> {
  if (!subscription.emailRecipients || subscription.emailRecipients.length === 0) {
    return { success: false, error: 'No email recipients configured' }
  }

  const statusEmoji = payload.data.status === 'success' ? '✅' : '❌'
  const statusText = payload.data.status === 'success' ? 'Success' : 'Error'

  const result = await sendEmail({
    to: subscription.emailRecipients,
    subject: `${statusEmoji} Workflow Execution: ${payload.data.workflowName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a; margin-bottom: 20px;">Workflow Execution ${statusText}</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 12px 0; color: #666; width: 140px;">Workflow</td>
            <td style="padding: 12px 0; color: #1a1a1a; font-weight: 500;">${payload.data.workflowName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 12px 0; color: #666;">Status</td>
            <td style="padding: 12px 0; color: ${payload.data.status === 'success' ? '#22c55e' : '#ef4444'}; font-weight: 500;">${statusText}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 12px 0; color: #666;">Trigger</td>
            <td style="padding: 12px 0; color: #1a1a1a;">${payload.data.trigger}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 12px 0; color: #666;">Duration</td>
            <td style="padding: 12px 0; color: #1a1a1a;">${payload.data.totalDurationMs}ms</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 12px 0; color: #666;">Execution ID</td>
            <td style="padding: 12px 0; color: #666; font-family: monospace; font-size: 12px;">${payload.data.executionId}</td>
          </tr>
        </table>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This notification was sent from Sim Studio workspace notifications.
        </p>
      </div>
    `,
    text: `Workflow Execution ${statusText}\n\nWorkflow: ${payload.data.workflowName}\nStatus: ${statusText}\nTrigger: ${payload.data.trigger}\nDuration: ${payload.data.totalDurationMs}ms\nExecution ID: ${payload.data.executionId}`,
    emailType: 'notifications',
  })

  return { success: result.success, error: result.success ? undefined : result.message }
}

async function deliverSlack(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload
): Promise<{ success: boolean; error?: string }> {
  if (!subscription.slackChannelId || !subscription.slackAccountId) {
    return { success: false, error: 'No Slack channel or account configured' }
  }

  const [slackAccount] = await db
    .select({ accessToken: account.accessToken, userId: account.userId })
    .from(account)
    .where(eq(account.id, subscription.slackAccountId))
    .limit(1)

  if (!slackAccount?.accessToken) {
    return { success: false, error: 'Slack account not found or not connected' }
  }

  const statusEmoji = payload.data.status === 'success' ? ':white_check_mark:' : ':x:'
  const statusColor = payload.data.status === 'success' ? '#22c55e' : '#ef4444'

  const slackPayload = {
    channel: subscription.slackChannelId,
    attachments: [
      {
        color: statusColor,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${statusEmoji} *Workflow Execution: ${payload.data.workflowName}*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Status:*\n${payload.data.status}` },
              { type: 'mrkdwn', text: `*Trigger:*\n${payload.data.trigger}` },
              { type: 'mrkdwn', text: `*Duration:*\n${payload.data.totalDurationMs}ms` },
              {
                type: 'mrkdwn',
                text: `*Cost:*\n${payload.data.cost?.total ? `$${(payload.data.cost.total as number).toFixed(4)}` : 'N/A'}`,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Execution ID: \`${payload.data.executionId}\``,
              },
            ],
          },
        ],
      },
    ],
    text: `${payload.data.status === 'success' ? '✅' : '❌'} Workflow ${payload.data.workflowName}: ${payload.data.status}`,
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${slackAccount.accessToken}`,
      },
      body: JSON.stringify(slackPayload),
    })

    const result = await response.json()

    return { success: result.ok, error: result.ok ? undefined : result.error }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

async function updateDeliveryStatus(
  deliveryId: string,
  status: 'success' | 'failed' | 'pending',
  error?: string,
  responseStatus?: number,
  nextAttemptAt?: Date
) {
  await db
    .update(workspaceNotificationDelivery)
    .set({
      status,
      errorMessage: error || null,
      responseStatus: responseStatus || null,
      nextAttemptAt: nextAttemptAt || null,
      updatedAt: new Date(),
    })
    .where(eq(workspaceNotificationDelivery.id, deliveryId))
}

export interface NotificationDeliveryParams {
  deliveryId: string
  subscriptionId: string
  notificationType: 'webhook' | 'email' | 'slack'
  log: WorkflowExecutionLog
}

export async function executeNotificationDelivery(params: NotificationDeliveryParams) {
  const { deliveryId, subscriptionId, notificationType, log } = params

  try {
    const [subscription] = await db
      .select()
      .from(workspaceNotificationSubscription)
      .where(eq(workspaceNotificationSubscription.id, subscriptionId))
      .limit(1)

    if (!subscription || !subscription.active) {
      logger.warn(`Subscription ${subscriptionId} not found or inactive`)
      await updateDeliveryStatus(deliveryId, 'failed', 'Subscription not found or inactive')
      return
    }

    const claimed = await db
      .update(workspaceNotificationDelivery)
      .set({
        status: 'in_progress',
        attempts: sql`${workspaceNotificationDelivery.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceNotificationDelivery.id, deliveryId),
          eq(workspaceNotificationDelivery.status, 'pending'),
          or(
            isNull(workspaceNotificationDelivery.nextAttemptAt),
            lte(workspaceNotificationDelivery.nextAttemptAt, new Date())
          )
        )
      )
      .returning({ attempts: workspaceNotificationDelivery.attempts })

    if (claimed.length === 0) {
      logger.info(`Delivery ${deliveryId} not claimable`)
      return
    }

    const attempts = claimed[0].attempts
    const payload = await buildPayload(log, subscription)

    let result: { success: boolean; status?: number; error?: string }

    switch (notificationType) {
      case 'webhook':
        result = await deliverWebhook(subscription, payload)
        break
      case 'email':
        result = await deliverEmail(subscription, payload)
        break
      case 'slack':
        result = await deliverSlack(subscription, payload)
        break
      default:
        result = { success: false, error: 'Unknown notification type' }
    }

    if (result.success) {
      await updateDeliveryStatus(deliveryId, 'success', undefined, result.status)
      logger.info(`${notificationType} notification delivered successfully`, { deliveryId })
    } else {
      if (attempts < MAX_ATTEMPTS) {
        const retryDelay = getRetryDelayWithJitter(
          RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
        )
        const nextAttemptAt = new Date(Date.now() + retryDelay)

        await updateDeliveryStatus(
          deliveryId,
          'pending',
          result.error,
          result.status,
          nextAttemptAt
        )

        logger.info(
          `${notificationType} notification failed, scheduled retry ${attempts}/${MAX_ATTEMPTS}`,
          {
            deliveryId,
            error: result.error,
          }
        )
      } else {
        await updateDeliveryStatus(deliveryId, 'failed', result.error, result.status)
        logger.error(`${notificationType} notification failed after ${MAX_ATTEMPTS} attempts`, {
          deliveryId,
          error: result.error,
        })
      }
    }
  } catch (error) {
    logger.error('Notification delivery failed', { deliveryId, error })
    await updateDeliveryStatus(deliveryId, 'failed', 'Internal error')
  }
}

export const workspaceNotificationDeliveryTask = task({
  id: 'workspace-notification-delivery',
  retry: { maxAttempts: 1 },
  run: async (params: NotificationDeliveryParams) => executeNotificationDelivery(params),
})
