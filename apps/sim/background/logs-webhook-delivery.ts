import { createHmac } from 'crypto'
import { task, wait } from '@trigger.dev/sdk'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { decryptSecret } from '@/lib/utils'
import { db } from '@/db'
import {
  workflowLogWebhook,
  workflowLogWebhookDelivery,
  workflow as workflowTable,
} from '@/db/schema'

const logger = createLogger('LogsWebhookDelivery')

// Quick retry strategy: 5 attempts over ~15 minutes
// Most webhook failures are transient and resolve quickly
const MAX_ATTEMPTS = 5
const RETRY_DELAYS = [
  5 * 1000, // 5 seconds (1st retry)
  15 * 1000, // 15 seconds (2nd retry)
  60 * 1000, // 1 minute (3rd retry)
  3 * 60 * 1000, // 3 minutes (4th retry)
  10 * 60 * 1000, // 10 minutes (5th and final retry)
]

// Add jitter to prevent thundering herd problem (up to 10% of delay)
function getRetryDelayWithJitter(baseDelay: number): number {
  const jitter = Math.random() * 0.1 * baseDelay
  return Math.floor(baseDelay + jitter)
}

interface WebhookPayload {
  id: string
  type: 'workflow.execution.completed'
  timestamp: number
  data: {
    workflowId: string
    executionId: string
    status: 'success' | 'error'
    level: string
    trigger: string
    startedAt: string
    endedAt: string
    totalDurationMs: number
    cost?: any
    files?: any
    finalOutput?: any
    traceSpans?: any[]
    rateLimits?: {
      sync: {
        limit: number
        remaining: number
        resetAt: string
      }
      async: {
        limit: number
        remaining: number
        resetAt: string
      }
    }
    usage?: {
      currentPeriodCost: number
      limit: number
      plan: string
      isExceeded: boolean
    }
  }
  links: {
    log: string
    execution: string
  }
}

function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signatureBase)
  return hmac.digest('hex')
}

export const logsWebhookDelivery = task({
  id: 'logs-webhook-delivery',
  retry: {
    maxAttempts: 1, // We handle retries manually within the task
  },
  run: async (params: {
    deliveryId: string
    subscriptionId: string
    log: WorkflowExecutionLog
  }) => {
    const { deliveryId, subscriptionId, log } = params

    try {
      const [subscription] = await db
        .select()
        .from(workflowLogWebhook)
        .where(eq(workflowLogWebhook.id, subscriptionId))
        .limit(1)

      if (!subscription || !subscription.active) {
        logger.warn(`Subscription ${subscriptionId} not found or inactive`)
        await db
          .update(workflowLogWebhookDelivery)
          .set({
            status: 'failed',
            errorMessage: 'Subscription not found or inactive',
            updatedAt: new Date(),
          })
          .where(eq(workflowLogWebhookDelivery.id, deliveryId))
        return
      }

      // Atomically claim this delivery row for processing and increment attempts
      const claimed = await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: 'in_progress',
          attempts: sql`${workflowLogWebhookDelivery.attempts} + 1`,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowLogWebhookDelivery.id, deliveryId),
            eq(workflowLogWebhookDelivery.status, 'pending'),
            // Only claim if not scheduled in the future or schedule has arrived
            or(
              isNull(workflowLogWebhookDelivery.nextAttemptAt),
              lte(workflowLogWebhookDelivery.nextAttemptAt, new Date())
            )
          )
        )
        .returning({ attempts: workflowLogWebhookDelivery.attempts })

      if (claimed.length === 0) {
        logger.info(`Delivery ${deliveryId} not claimable (already in progress or not due)`)
        return
      }

      const attempts = claimed[0].attempts
      const timestamp = Date.now()
      const eventId = `evt_${uuidv4()}`

      const payload: WebhookPayload = {
        id: eventId,
        type: 'workflow.execution.completed',
        timestamp,
        data: {
          workflowId: log.workflowId,
          executionId: log.executionId,
          status: log.level === 'error' ? 'error' : 'success',
          level: log.level,
          trigger: log.trigger,
          startedAt: log.startedAt,
          endedAt: log.endedAt || log.startedAt,
          totalDurationMs: log.totalDurationMs,
          cost: log.cost,
          files: (log as any).files,
        },
        links: {
          log: `/v1/logs/${log.id}`,
          execution: `/v1/logs/executions/${log.executionId}`,
        },
      }

      if (subscription.includeFinalOutput && log.executionData) {
        payload.data.finalOutput = (log.executionData as any).finalOutput
      }

      if (subscription.includeTraceSpans && log.executionData) {
        payload.data.traceSpans = (log.executionData as any).traceSpans
      }

      // Fetch rate limits and usage data if requested
      if ((subscription.includeRateLimits || subscription.includeUsageData) && log.executionData) {
        const executionData = log.executionData as any

        const needsRateLimits = subscription.includeRateLimits && executionData.includeRateLimits
        const needsUsage = subscription.includeUsageData && executionData.includeUsageData
        if (needsRateLimits || needsUsage) {
          const { getUserLimits } = await import('@/app/api/v1/logs/meta')
          const workflow = await db
            .select()
            .from(workflowTable)
            .where(eq(workflowTable.id, log.workflowId))
            .limit(1)

          if (workflow.length > 0) {
            try {
              const limits = await getUserLimits(workflow[0].userId)
              if (needsRateLimits) {
                payload.data.rateLimits = limits.workflowExecutionRateLimit
              }
              if (needsUsage) {
                payload.data.usage = limits.usage
              }
            } catch (error) {
              logger.warn('Failed to fetch limits/usage for webhook', { error })
            }
          }
        }
      }

      const body = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'sim-event': 'workflow.execution.completed',
        'sim-timestamp': timestamp.toString(),
        'sim-delivery-id': deliveryId,
        'Idempotency-Key': deliveryId,
      }

      if (subscription.secret) {
        const { decrypted } = await decryptSecret(subscription.secret)
        const signature = generateSignature(decrypted, timestamp, body)
        headers['sim-signature'] = `t=${timestamp},v1=${signature}`
      }

      logger.info(`Attempting webhook delivery ${deliveryId} (attempt ${attempts})`, {
        url: subscription.url,
        executionId: log.executionId,
      })

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      try {
        const response = await fetch(subscription.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        const responseBody = await response.text().catch(() => '')
        const truncatedBody = responseBody.slice(0, 1000)

        if (response.ok) {
          await db
            .update(workflowLogWebhookDelivery)
            .set({
              status: 'success',
              attempts,
              lastAttemptAt: new Date(),
              responseStatus: response.status,
              responseBody: truncatedBody,
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowLogWebhookDelivery.id, deliveryId),
                eq(workflowLogWebhookDelivery.status, 'in_progress')
              )
            )

          logger.info(`Webhook delivery ${deliveryId} succeeded`, {
            status: response.status,
            executionId: log.executionId,
          })

          return { success: true }
        }

        const isRetryable = response.status >= 500 || response.status === 429

        if (!isRetryable || attempts >= MAX_ATTEMPTS) {
          await db
            .update(workflowLogWebhookDelivery)
            .set({
              status: 'failed',
              attempts,
              lastAttemptAt: new Date(),
              responseStatus: response.status,
              responseBody: truncatedBody,
              errorMessage: `HTTP ${response.status}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workflowLogWebhookDelivery.id, deliveryId),
                eq(workflowLogWebhookDelivery.status, 'in_progress')
              )
            )

          logger.warn(`Webhook delivery ${deliveryId} failed permanently`, {
            status: response.status,
            attempts,
            executionId: log.executionId,
          })

          return { success: false }
        }

        const baseDelay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]
        const delayWithJitter = getRetryDelayWithJitter(baseDelay)
        const nextAttemptAt = new Date(Date.now() + delayWithJitter)

        await db
          .update(workflowLogWebhookDelivery)
          .set({
            status: 'pending',
            attempts,
            lastAttemptAt: new Date(),
            nextAttemptAt,
            responseStatus: response.status,
            responseBody: truncatedBody,
            errorMessage: `HTTP ${response.status} - will retry`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowLogWebhookDelivery.id, deliveryId),
              eq(workflowLogWebhookDelivery.status, 'in_progress')
            )
          )

        // Schedule the next retry
        await wait.for({ seconds: delayWithJitter / 1000 })

        // Recursively call the task for retry
        await logsWebhookDelivery.trigger({
          deliveryId,
          subscriptionId,
          log,
        })

        return { success: false, retrying: true }
      } catch (error: any) {
        clearTimeout(timeoutId)

        if (error.name === 'AbortError') {
          logger.error(`Webhook delivery ${deliveryId} timed out`, {
            executionId: log.executionId,
            attempts,
          })
          error.message = 'Request timeout after 30 seconds'
        }

        const baseDelay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]
        const delayWithJitter = getRetryDelayWithJitter(baseDelay)
        const nextAttemptAt = new Date(Date.now() + delayWithJitter)

        await db
          .update(workflowLogWebhookDelivery)
          .set({
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            lastAttemptAt: new Date(),
            nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : nextAttemptAt,
            errorMessage: error.message,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowLogWebhookDelivery.id, deliveryId),
              eq(workflowLogWebhookDelivery.status, 'in_progress')
            )
          )

        if (attempts >= MAX_ATTEMPTS) {
          logger.error(`Webhook delivery ${deliveryId} failed after ${attempts} attempts`, {
            error: error.message,
            executionId: log.executionId,
          })
          return { success: false }
        }

        // Schedule the next retry
        await wait.for({ seconds: delayWithJitter / 1000 })

        // Recursively call the task for retry
        await logsWebhookDelivery.trigger({
          deliveryId,
          subscriptionId,
          log,
        })

        return { success: false, retrying: true }
      }
    } catch (error: any) {
      logger.error(`Webhook delivery ${deliveryId} encountered unexpected error`, {
        error: error.message,
        stack: error.stack,
      })

      // Mark as failed for unexpected errors
      await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: 'failed',
          errorMessage: `Unexpected error: ${error.message}`,
          updatedAt: new Date(),
        })
        .where(eq(workflowLogWebhookDelivery.id, deliveryId))

      return { success: false, error: error.message }
    }
  },
})
