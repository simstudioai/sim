import { createHmac } from 'crypto'
import { db } from '@sim/db'
import { permissions, workflow, workflowLogWebhook } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('WorkflowLogWebhookTestAPI')

function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signatureBase)
  return hmac.digest('hex')
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params
    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('webhookId')

    if (!webhookId) {
      return NextResponse.json({ error: 'webhookId is required' }, { status: 400 })
    }

    const hasAccess = await db
      .select({ id: workflow.id })
      .from(workflow)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (hasAccess.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const [webhook] = await db
      .select()
      .from(workflowLogWebhook)
      .where(
        and(eq(workflowLogWebhook.id, webhookId), eq(workflowLogWebhook.workflowId, workflowId))
      )
      .limit(1)

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const timestamp = Date.now()
    const eventId = `evt_test_${uuidv4()}`
    const executionId = `exec_test_${uuidv4()}`
    const logId = `log_test_${uuidv4()}`

    const payload = {
      id: eventId,
      type: 'workflow.execution.completed',
      timestamp,
      data: {
        workflowId,
        executionId,
        status: 'success',
        level: 'info',
        trigger: 'manual',
        startedAt: new Date(timestamp - 5000).toISOString(),
        endedAt: new Date(timestamp).toISOString(),
        totalDurationMs: 5000,
        cost: {
          total: 0.00123,
          tokens: { prompt: 100, completion: 50, total: 150 },
          models: {
            'gpt-4o': {
              input: 0.001,
              output: 0.00023,
              total: 0.00123,
              tokens: { prompt: 100, completion: 50, total: 150 },
            },
          },
        },
        files: null,
      },
      links: {
        log: `/v1/logs/${logId}`,
        execution: `/v1/logs/executions/${executionId}`,
      },
    }

    if (webhook.includeFinalOutput) {
      ;(payload.data as any).finalOutput = {
        message: 'This is a test webhook delivery',
        test: true,
      }
    }

    if (webhook.includeTraceSpans) {
      ;(payload.data as any).traceSpans = [
        {
          id: 'span_test_1',
          name: 'Test Block',
          type: 'block',
          status: 'success',
          startTime: new Date(timestamp - 5000).toISOString(),
          endTime: new Date(timestamp).toISOString(),
          duration: 5000,
        },
      ]
    }

    if (webhook.includeRateLimits) {
      ;(payload.data as any).rateLimits = {
        sync: {
          limit: 150,
          remaining: 45,
          resetAt: new Date(timestamp + 60000).toISOString(),
        },
        async: {
          limit: 1000,
          remaining: 50,
          resetAt: new Date(timestamp + 60000).toISOString(),
        },
      }
    }

    if (webhook.includeUsageData) {
      ;(payload.data as any).usage = {
        currentPeriodCost: 2.45,
        limit: 10,
        plan: 'pro',
        isExceeded: false,
      }
    }

    const body = JSON.stringify(payload)
    const deliveryId = `delivery_test_${uuidv4()}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'sim-event': 'workflow.execution.completed',
      'sim-timestamp': timestamp.toString(),
      'sim-delivery-id': deliveryId,
      'Idempotency-Key': deliveryId,
    }

    if (webhook.secret) {
      const { decrypted } = await decryptSecret(webhook.secret)
      const signature = generateSignature(decrypted, timestamp, body)
      headers['sim-signature'] = `t=${timestamp},v1=${signature}`
    }

    logger.info(`Sending test webhook to ${webhook.url}`, { workflowId, webhookId })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseBody = await response.text().catch(() => '')
      const truncatedBody = responseBody.slice(0, 500)

      const result = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: truncatedBody,
        timestamp: new Date().toISOString(),
      }

      logger.info(`Test webhook completed`, {
        workflowId,
        webhookId,
        status: response.status,
        success: response.ok,
      })

      return NextResponse.json({ data: result })
    } catch (error: any) {
      clearTimeout(timeoutId)

      if (error.name === 'AbortError') {
        logger.error(`Test webhook timed out`, { workflowId, webhookId })
        return NextResponse.json({
          data: {
            success: false,
            error: 'Request timeout after 10 seconds',
            timestamp: new Date().toISOString(),
          },
        })
      }

      logger.error(`Test webhook failed`, {
        workflowId,
        webhookId,
        error: error.message,
      })

      return NextResponse.json({
        data: {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        },
      })
    }
  } catch (error) {
    logger.error('Error testing webhook', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
