import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { task } from '@trigger.dev/sdk'
import { NextRequest } from 'next/server'
import type { QuickBooksWebhookEvent } from '@/lib/api/contracts/webhooks'
import { getJobQueue } from '@/lib/core/async-jobs'
import { dispatchResolvedWebhookTarget, findWebhooksByRoutingKey } from '@/lib/webhooks/processor'
import { buildQuickBooksWebhookRoutingKey } from '@/lib/webhooks/quickbooks-credentials'

const logger = createLogger('QuickBooksWebhookIngressTask')

export const QUICKBOOKS_WEBHOOK_INGRESS_CONCURRENCY_LIMIT = 50
export const QUICKBOOKS_WEBHOOK_INGRESS_MAX_ATTEMPTS = 3

export interface QuickBooksWebhookIngressPayload {
  appKey: string
  events: QuickBooksWebhookEvent[]
  headers: { 'content-type': string }
  requestId: string
  receivedAt: number
}

export interface QuickBooksWebhookIngressResult {
  failed: number
  ignored: number
  processed: number
  targetCount: number
}

/** Process the bounded delivery sequentially through the shared routing-key dispatcher. */
export async function executeQuickBooksWebhookIngress(
  payload: QuickBooksWebhookIngressPayload
): Promise<QuickBooksWebhookIngressResult> {
  let ignored = 0
  let processed = 0
  let failed = 0
  let targetCount = 0

  for (const [eventIndex, event] of payload.events.entries()) {
    let routingKey: string
    try {
      routingKey = buildQuickBooksWebhookRoutingKey(payload.appKey, event.intuitaccountid)
    } catch (error) {
      ignored += 1
      logger.warn(`[${payload.requestId}] QuickBooks webhook event is not routable`, {
        error: getErrorMessage(error, 'Unknown error'),
        eventId: event.id,
        eventIndex,
      })
      continue
    }

    const request = new NextRequest(
      `http://internal/api/webhooks/quickbooks/${encodeURIComponent(payload.appKey)}`,
      {
        method: 'POST',
        headers: payload.headers,
        body: JSON.stringify(event),
      }
    )

    try {
      const targets = await findWebhooksByRoutingKey(routingKey, payload.requestId, 'quickbooks')
      targetCount += targets.length

      for (const { webhook, workflow } of targets) {
        try {
          const result = await dispatchResolvedWebhookTarget(webhook, workflow, event, request, {
            requestId: payload.requestId,
            path: webhook.path ?? undefined,
            receivedAt: payload.receivedAt,
            triggerTimestampMs: Date.parse(event.time),
          })
          if (result.outcome === 'queued') processed += 1
          else if (result.outcome === 'ignored') ignored += 1
          else failed += 1
        } catch (error) {
          failed += 1
          logger.error(`[${payload.requestId}] QuickBooks webhook target dispatch failed`, {
            error,
            eventId: event.id,
            eventIndex,
            webhookId: webhook.id,
          })
        }
      }

      logger.info(`[${payload.requestId}] QuickBooks webhook event completed`, {
        eventId: event.id,
        eventIndex,
        ignored,
        processed,
        targetCount: targets.length,
      })
    } catch (error) {
      failed += 1
      logger.error(`[${payload.requestId}] QuickBooks webhook target lookup failed`, {
        error,
        eventId: event.id,
        eventIndex,
      })
    }
  }

  logger.info(`[${payload.requestId}] QuickBooks webhook delivery completed`, {
    eventCount: payload.events.length,
    failed,
    ignored,
    processed,
    targetCount,
  })
  return { failed, ignored, processed, targetCount }
}

async function runQuickBooksWebhookIngressJob(
  payload: QuickBooksWebhookIngressPayload
): Promise<void> {
  const result = await executeQuickBooksWebhookIngress(payload)
  if (result.failed > 0) {
    throw new Error(`QuickBooks webhook delivery completed with ${result.failed} failures`)
  }
}

export async function enqueueQuickBooksWebhookIngress(
  payload: QuickBooksWebhookIngressPayload
): Promise<string> {
  const jobQueue = await getJobQueue()
  const deliveryHash = createHash('sha256').update(payload.appKey).update('\0')
  for (const event of payload.events) {
    deliveryHash.update(event.id).update('\0')
  }
  return jobQueue.enqueue('quickbooks-webhook-ingress', payload, {
    jobId: `quickbooks-webhook-ingress:${deliveryHash.digest('base64url')}`,
    maxAttempts: QUICKBOOKS_WEBHOOK_INGRESS_MAX_ATTEMPTS,
    concurrencyKey: 'quickbooks-webhook-ingress',
    concurrencyLimit: QUICKBOOKS_WEBHOOK_INGRESS_CONCURRENCY_LIMIT,
    runner: async () => runQuickBooksWebhookIngressJob(payload),
  })
}

export const quickBooksWebhookIngressTask = task({
  id: 'quickbooks-webhook-ingress',
  machine: 'small-1x',
  retry: {
    maxAttempts: QUICKBOOKS_WEBHOOK_INGRESS_MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
  },
  queue: { concurrencyLimit: QUICKBOOKS_WEBHOOK_INGRESS_CONCURRENCY_LIMIT },
  run: async (payload: QuickBooksWebhookIngressPayload) => runQuickBooksWebhookIngressJob(payload),
})
