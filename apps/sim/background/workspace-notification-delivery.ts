import { createHmac } from 'crypto'
import { db } from '@sim/db'
import {
  account,
  workflow as workflowTable,
  workspaceNotificationDelivery,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  type EmailRateLimitsData,
  type EmailUsageData,
  renderWorkflowNotificationEmail,
} from '@/components/emails'
import { checkUsageStatus } from '@/lib/billing/calculations/usage-monitor'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { decryptSecret } from '@/lib/core/security/encryption'
import { formatDuration } from '@/lib/core/utils/formatting'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { TraceSpan, WorkflowExecutionLog } from '@/lib/logs/types'
import { sendEmail } from '@/lib/messaging/email/mailer'
import type { AlertConfig } from '@/lib/notifications/alert-rules'

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
    traceSpans?: TraceSpan[]
    rateLimits?: EmailRateLimitsData
    usage?: EmailUsageData
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
): Promise<NotificationPayload | null> {
  // Skip notifications for deleted workflows
  if (!log.workflowId) return null

  const workflowData = await db
    .select({ name: workflowTable.name, userId: workflowTable.userId })
    .from(workflowTable)
    .where(eq(workflowTable.id, log.workflowId))
    .limit(1)

  const timestamp = Date.now()
  const executionData = (log.executionData || {}) as Record<string, unknown>
  const userId = workflowData[0]?.userId

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
      cost: log.cost as Record<string, unknown>,
    },
  }

  if (subscription.includeFinalOutput && executionData.finalOutput) {
    payload.data.finalOutput = executionData.finalOutput
  }

  // Trace spans only included for webhooks (too large for email/Slack)
  if (
    subscription.includeTraceSpans &&
    subscription.notificationType === 'webhook' &&
    executionData.traceSpans
  ) {
    payload.data.traceSpans = executionData.traceSpans as TraceSpan[]
  }

  if (subscription.includeRateLimits && userId) {
    try {
      const userSubscription = await getHighestPrioritySubscription(userId)
      const rateLimiter = new RateLimiter()
      const triggerType = log.trigger === 'api' ? 'api' : 'manual'

      const [syncStatus, asyncStatus] = await Promise.all([
        rateLimiter.getRateLimitStatusWithSubscription(
          userId,
          userSubscription,
          triggerType,
          false
        ),
        rateLimiter.getRateLimitStatusWithSubscription(userId, userSubscription, triggerType, true),
      ])

      payload.data.rateLimits = {
        sync: {
          requestsPerMinute: syncStatus.requestsPerMinute,
          maxBurst: syncStatus.maxBurst,
          remaining: syncStatus.remaining,
          resetAt: syncStatus.resetAt.toISOString(),
        },
        async: {
          requestsPerMinute: asyncStatus.requestsPerMinute,
          maxBurst: asyncStatus.maxBurst,
          remaining: asyncStatus.remaining,
          resetAt: asyncStatus.resetAt.toISOString(),
        },
      }
    } catch (error) {
      logger.warn('Failed to fetch rate limits for notification', { error, userId })
    }
  }

  if (subscription.includeUsageData && userId) {
    try {
      const usageData = await checkUsageStatus(userId)
      payload.data.usage = {
        currentPeriodCost: usageData.currentUsage,
        limit: usageData.limit,
        percentUsed: usageData.percentUsed,
        isExceeded: usageData.isExceeded,
      }
    } catch (error) {
      logger.warn('Failed to fetch usage data for notification', { error, userId })
    }
  }

  return payload
}

interface WebhookConfig {
  url: string
  secret?: string
}

interface SlackConfig {
  channelId: string
  channelName: string
  accountId: string
}

async function deliverWebhook(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload
): Promise<{ success: boolean; status?: number; error?: string }> {
  const webhookConfig = subscription.webhookConfig as WebhookConfig | null
  if (!webhookConfig?.url) {
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

  if (webhookConfig.secret) {
    const { decrypted } = await decryptSecret(webhookConfig.secret)
    const signature = generateSignature(decrypted, payload.timestamp, body)
    headers['sim-signature'] = `t=${payload.timestamp},v1=${signature}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(webhookConfig.url, {
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

function formatCost(cost?: Record<string, unknown>): string {
  if (!cost?.total) return 'N/A'
  const total = cost.total as number
  return `$${total.toFixed(4)}`
}

function buildLogUrl(workspaceId: string, executionId: string): string {
  return `${getBaseUrl()}/workspace/${workspaceId}/logs?search=${encodeURIComponent(executionId)}`
}

function formatAlertReason(alertConfig: AlertConfig): string {
  switch (alertConfig.rule) {
    case 'consecutive_failures':
      return `${alertConfig.consecutiveFailures} consecutive failures detected`
    case 'failure_rate':
      return `Failure rate exceeded ${alertConfig.failureRatePercent}% over ${alertConfig.windowHours}h`
    case 'latency_threshold':
      return `Execution exceeded ${Math.round((alertConfig.durationThresholdMs || 0) / 1000)}s duration threshold`
    case 'latency_spike':
      return `Execution was ${alertConfig.latencySpikePercent}% slower than average`
    case 'cost_threshold':
      return `Execution cost exceeded $${alertConfig.costThresholdDollars} threshold`
    case 'no_activity':
      return `No workflow activity detected in ${alertConfig.inactivityHours}h`
    case 'error_count':
      return `${alertConfig.errorCountThreshold} errors detected in ${alertConfig.windowHours}h window`
    default:
      return 'Alert condition met'
  }
}

async function deliverEmail(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload,
  alertConfig?: AlertConfig
): Promise<{ success: boolean; error?: string }> {
  if (!subscription.emailRecipients || subscription.emailRecipients.length === 0) {
    return { success: false, error: 'No email recipients configured' }
  }

  const isError = payload.data.status !== 'success'
  const statusText = isError ? 'Error' : 'Success'
  const logUrl = buildLogUrl(subscription.workspaceId, payload.data.executionId)
  const alertReason = alertConfig ? formatAlertReason(alertConfig) : undefined

  // Build subject line
  const subject = alertReason
    ? `Alert: ${payload.data.workflowName}`
    : isError
      ? `Error Alert: ${payload.data.workflowName}`
      : `Workflow Completed: ${payload.data.workflowName}`

  // Build plain text for fallback
  let includedDataText = ''
  if (payload.data.finalOutput) {
    includedDataText += `\n\nFinal Output:\n${JSON.stringify(payload.data.finalOutput, null, 2)}`
  }
  if (payload.data.rateLimits) {
    includedDataText += `\n\nRate Limits:\n${JSON.stringify(payload.data.rateLimits, null, 2)}`
  }
  if (payload.data.usage) {
    includedDataText += `\n\nUsage Data:\n${JSON.stringify(payload.data.usage, null, 2)}`
  }

  // Render the email using the shared template
  const html = await renderWorkflowNotificationEmail({
    workflowName: payload.data.workflowName || 'Unknown Workflow',
    status: payload.data.status,
    trigger: payload.data.trigger,
    duration: formatDuration(payload.data.totalDurationMs, { precision: 1 }) ?? '-',
    cost: formatCost(payload.data.cost),
    logUrl,
    alertReason,
    finalOutput: payload.data.finalOutput,
    rateLimits: payload.data.rateLimits,
    usageData: payload.data.usage,
  })

  const result = await sendEmail({
    to: subscription.emailRecipients,
    subject,
    html,
    text: `${subject}\n${alertReason ? `\nReason: ${alertReason}\n` : ''}\nWorkflow: ${payload.data.workflowName}\nStatus: ${statusText}\nTrigger: ${payload.data.trigger}\nDuration: ${formatDuration(payload.data.totalDurationMs, { precision: 1 }) ?? '-'}\nCost: ${formatCost(payload.data.cost)}\n\nView Log: ${logUrl}${includedDataText}`,
    emailType: 'notifications',
  })

  return { success: result.success, error: result.success ? undefined : result.message }
}

async function deliverSlack(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  payload: NotificationPayload,
  alertConfig?: AlertConfig
): Promise<{ success: boolean; error?: string }> {
  const slackConfig = subscription.slackConfig as SlackConfig | null
  if (!slackConfig?.channelId || !slackConfig?.accountId) {
    return { success: false, error: 'No Slack channel or account configured' }
  }

  const [slackAccount] = await db
    .select({ accessToken: account.accessToken, userId: account.userId })
    .from(account)
    .where(eq(account.id, slackConfig.accountId))
    .limit(1)

  if (!slackAccount?.accessToken) {
    return { success: false, error: 'Slack account not found or not connected' }
  }

  const alertReason = alertConfig ? formatAlertReason(alertConfig) : null
  const statusEmoji = alertReason
    ? ':warning:'
    : payload.data.status === 'success'
      ? ':white_check_mark:'
      : ':x:'
  const statusColor = alertReason
    ? '#d97706'
    : payload.data.status === 'success'
      ? '#22c55e'
      : '#ef4444'
  const logUrl = buildLogUrl(subscription.workspaceId, payload.data.executionId)

  const blocks: Array<Record<string, unknown>> = []

  if (alertReason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${alertReason}`,
      },
    })
  }

  blocks.push(
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status:*\n${payload.data.status}` },
        { type: 'mrkdwn', text: `*Trigger:*\n${payload.data.trigger}` },
        {
          type: 'mrkdwn',
          text: `*Duration:*\n${formatDuration(payload.data.totalDurationMs, { precision: 1 }) ?? '-'}`,
        },
        { type: 'mrkdwn', text: `*Cost:*\n${formatCost(payload.data.cost)}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Log →', emoji: true },
          url: logUrl,
          style: 'primary',
        },
      ],
    }
  )

  if (payload.data.finalOutput) {
    const outputStr = JSON.stringify(payload.data.finalOutput, null, 2)
    const truncated = outputStr.length > 2900 ? `${outputStr.slice(0, 2900)}...` : outputStr
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Final Output:*\n\`\`\`${truncated}\`\`\``,
      },
    })
  }

  if (payload.data.rateLimits) {
    const limitsStr = JSON.stringify(payload.data.rateLimits, null, 2)
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Rate Limits:*\n\`\`\`${limitsStr}\`\`\``,
      },
    })
  }

  if (payload.data.usage) {
    const usageStr = JSON.stringify(payload.data.usage, null, 2)
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Usage Data:*\n\`\`\`${usageStr}\`\`\``,
      },
    })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Execution ID: \`${payload.data.executionId}\`` }],
  })

  const fallbackText = alertReason
    ? `⚠️ Alert: ${payload.data.workflowName} - ${alertReason}`
    : `${payload.data.status === 'success' ? '✅' : '❌'} Workflow ${payload.data.workflowName}: ${payload.data.status}`

  const slackPayload = {
    channel: slackConfig.channelId,
    attachments: [{ color: statusColor, blocks }],
    text: fallbackText,
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
  alertConfig?: AlertConfig
}

export async function executeNotificationDelivery(params: NotificationDeliveryParams) {
  const { deliveryId, subscriptionId, notificationType, log, alertConfig } = params

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

    // Skip delivery for deleted workflows
    if (!payload) {
      await updateDeliveryStatus(deliveryId, 'failed', 'Workflow was deleted')
      logger.info(`Skipping delivery ${deliveryId} - workflow was deleted`)
      return
    }

    let result: { success: boolean; status?: number; error?: string }

    switch (notificationType) {
      case 'webhook':
        result = await deliverWebhook(subscription, payload)
        break
      case 'email':
        result = await deliverEmail(subscription, payload, alertConfig)
        break
      case 'slack':
        result = await deliverSlack(subscription, payload, alertConfig)
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
