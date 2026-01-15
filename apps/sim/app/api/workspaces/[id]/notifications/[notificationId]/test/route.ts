import { createHmac } from 'crypto'
import { db } from '@sim/db'
import { account, workspaceNotificationSubscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  type EmailRateLimitsData,
  type EmailUsageData,
  renderWorkflowNotificationEmail,
} from '@/components/emails'
import { getSession } from '@/lib/auth'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceNotificationTestAPI')

type RouteParams = { params: Promise<{ id: string; notificationId: string }> }

interface WebhookConfig {
  url: string
  secret?: string
}

interface SlackConfig {
  channelId: string
  channelName: string
  accountId: string
}

function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signatureBase)
  return hmac.digest('hex')
}

function buildTestPayload(subscription: typeof workspaceNotificationSubscription.$inferSelect) {
  const timestamp = Date.now()
  const eventId = `evt_test_${uuidv4()}`
  const executionId = `exec_test_${uuidv4()}`

  const payload: Record<string, unknown> = {
    id: eventId,
    type: 'workflow.execution.completed',
    timestamp,
    data: {
      workflowId: 'test-workflow-id',
      workflowName: 'Test Workflow',
      executionId,
      status: 'success',
      level: 'info',
      trigger: 'manual',
      startedAt: new Date(timestamp - 5000).toISOString(),
      endedAt: new Date(timestamp).toISOString(),
      totalDurationMs: 5000,
      cost: {
        total: 0.00123,
        tokens: { input: 100, output: 50, total: 150 },
      },
    },
    links: {
      log: `/workspace/logs`,
    },
  }

  const data = payload.data as Record<string, unknown>

  if (subscription.includeFinalOutput) {
    data.finalOutput = { message: 'This is a test notification', test: true }
  }

  if (subscription.includeRateLimits) {
    data.rateLimits = {
      sync: {
        requestsPerMinute: 150,
        remaining: 45,
        resetAt: new Date(timestamp + 60000).toISOString(),
      },
      async: {
        requestsPerMinute: 1000,
        remaining: 50,
        resetAt: new Date(timestamp + 60000).toISOString(),
      },
    }
  }

  if (subscription.includeUsageData) {
    data.usage = { currentPeriodCost: 2.45, limit: 20, percentUsed: 12.25, isExceeded: false }
  }

  if (subscription.includeTraceSpans && subscription.notificationType === 'webhook') {
    data.traceSpans = [
      {
        name: 'test-block',
        startTime: timestamp,
        endTime: timestamp + 150,
        duration: 150,
        status: 'success',
        blockId: 'block_test_1',
        blockType: 'agent',
        blockName: 'Test Agent',
        children: [],
      },
    ]
  }

  return { payload, timestamp }
}

async function testWebhook(subscription: typeof workspaceNotificationSubscription.$inferSelect) {
  const webhookConfig = subscription.webhookConfig as WebhookConfig | null
  if (!webhookConfig?.url) {
    return { success: false, error: 'No webhook URL configured' }
  }

  const { payload, timestamp } = buildTestPayload(subscription)
  const body = JSON.stringify(payload)
  const deliveryId = `delivery_test_${uuidv4()}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'sim-event': 'workflow.execution.completed',
    'sim-timestamp': timestamp.toString(),
    'sim-delivery-id': deliveryId,
    'Idempotency-Key': deliveryId,
  }

  if (webhookConfig.secret) {
    const { decrypted } = await decryptSecret(webhookConfig.secret)
    const signature = generateSignature(decrypted, timestamp, body)
    headers['sim-signature'] = `t=${timestamp},v1=${signature}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(webhookConfig.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const responseBody = await response.text().catch(() => '')

    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: responseBody.slice(0, 500),
      timestamp: new Date().toISOString(),
    }
  } catch (error: unknown) {
    clearTimeout(timeoutId)
    const err = error as Error & { name?: string }
    if (err.name === 'AbortError') {
      return { success: false, error: 'Request timeout after 10 seconds' }
    }
    return { success: false, error: err.message }
  }
}

async function testEmail(subscription: typeof workspaceNotificationSubscription.$inferSelect) {
  if (!subscription.emailRecipients || subscription.emailRecipients.length === 0) {
    return { success: false, error: 'No email recipients configured' }
  }

  const { payload } = buildTestPayload(subscription)
  const data = (payload as Record<string, unknown>).data as Record<string, unknown>
  const baseUrl = getBaseUrl()
  const logUrl = `${baseUrl}/workspace/${subscription.workspaceId}/logs`

  const html = await renderWorkflowNotificationEmail({
    workflowName: data.workflowName as string,
    status: data.status as 'success' | 'error',
    trigger: data.trigger as string,
    duration: `${data.totalDurationMs}ms`,
    cost: `$${(((data.cost as Record<string, unknown>)?.total as number) || 0).toFixed(4)}`,
    logUrl,
    finalOutput: data.finalOutput,
    rateLimits: data.rateLimits as EmailRateLimitsData | undefined,
    usageData: data.usage as EmailUsageData | undefined,
  })

  const result = await sendEmail({
    to: subscription.emailRecipients,
    subject: `[Test] Workflow Execution: ${data.workflowName}`,
    html,
    text: `This is a test notification from Sim.\n\nWorkflow: ${data.workflowName}\nStatus: ${data.status}\nDuration: ${data.totalDurationMs}ms\n\nView Log: ${logUrl}\n\nThis notification is configured for workspace notifications.`,
    emailType: 'notifications',
  })

  return {
    success: result.success,
    message: result.message,
    timestamp: new Date().toISOString(),
  }
}

async function testSlack(
  subscription: typeof workspaceNotificationSubscription.$inferSelect,
  userId: string
) {
  const slackConfig = subscription.slackConfig as SlackConfig | null
  if (!slackConfig?.channelId || !slackConfig?.accountId) {
    return { success: false, error: 'No Slack channel or account configured' }
  }

  const [slackAccount] = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.id, slackConfig.accountId), eq(account.userId, userId)))
    .limit(1)

  if (!slackAccount?.accessToken) {
    return { success: false, error: 'Slack account not found or not connected' }
  }

  const { payload } = buildTestPayload(subscription)
  const data = (payload as Record<string, unknown>).data as Record<string, unknown>

  const slackPayload = {
    channel: slackConfig.channelId,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🧪 Test Notification', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Workflow:*\n${data.workflowName}` },
          { type: 'mrkdwn', text: `*Status:*\n✅ ${data.status}` },
          { type: 'mrkdwn', text: `*Duration:*\n${data.totalDurationMs}ms` },
          { type: 'mrkdwn', text: `*Trigger:*\n${data.trigger}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'This is a test notification from Sim workspace notifications.',
          },
        ],
      },
    ],
    text: `Test notification: ${data.workflowName} - ${data.status}`,
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

    return {
      success: result.ok,
      error: result.error,
      channel: result.channel,
      timestamp: new Date().toISOString(),
    }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, notificationId } = await params
    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const [subscription] = await db
      .select()
      .from(workspaceNotificationSubscription)
      .where(
        and(
          eq(workspaceNotificationSubscription.id, notificationId),
          eq(workspaceNotificationSubscription.workspaceId, workspaceId)
        )
      )
      .limit(1)

    if (!subscription) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    let result: Record<string, unknown>

    switch (subscription.notificationType) {
      case 'webhook':
        result = await testWebhook(subscription)
        break
      case 'email':
        result = await testEmail(subscription)
        break
      case 'slack':
        result = await testSlack(subscription, session.user.id)
        break
      default:
        return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
    }

    logger.info('Test notification sent', {
      workspaceId,
      subscriptionId: notificationId,
      type: subscription.notificationType,
      success: result.success,
    })

    return NextResponse.json({ data: result })
  } catch (error) {
    logger.error('Error testing notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
