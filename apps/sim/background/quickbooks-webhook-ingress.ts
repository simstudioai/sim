import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { NextRequest } from 'next/server'
import type { QuickBooksWebhookEvent } from '@/lib/api/contracts/webhooks'
import { getJobQueue } from '@/lib/core/async-jobs'
import { dispatchResolvedWebhookTarget } from '@/lib/webhooks/processor'
import { findQuickBooksWebhookTargetPage } from '@/background/quickbooks-webhook-targets'

const logger = createLogger('QuickBooksWebhookIngressTask')

export const QUICKBOOKS_WEBHOOK_INGRESS_CONCURRENCY_LIMIT = 50
export const QUICKBOOKS_WEBHOOK_INGRESS_MAX_ATTEMPTS = 3

export interface QuickBooksWebhookIngressPayload {
  afterWebhookId?: string
  eventIndex?: number
  events: QuickBooksWebhookEvent[]
  headers: { 'content-type': string }
  requestId: string
  receivedAt: number
}

export interface QuickBooksWebhookIngressResult {
  ignored: number
  nextCursor?: string
  processed: number
  targetCount: number
}

/** Process one event against one bounded target page. */
export async function executeQuickBooksWebhookIngress(
  payload: QuickBooksWebhookIngressPayload
): Promise<QuickBooksWebhookIngressResult> {
  const eventIndex = payload.eventIndex ?? 0
  const event = payload.events[eventIndex]
  if (!event) return { ignored: 0, processed: 0, targetCount: 0 }

  const request = new NextRequest('http://internal/api/webhooks/quickbooks', {
    method: 'POST',
    headers: payload.headers,
    body: JSON.stringify(event),
  })
  const page = await findQuickBooksWebhookTargetPage(
    event.intuitaccountid,
    payload.requestId,
    payload.afterWebhookId
  )
  const nextCursor = page.hasMore ? page.nextCursor : null
  if (page.hasMore && (!nextCursor || nextCursor === payload.afterWebhookId)) {
    throw new Error('QuickBooks webhook target pagination did not advance')
  }

  let ignored = 0
  let processed = 0
  let failed = 0
  for (const { webhook, workflow } of page.targets) {
    const result = await dispatchResolvedWebhookTarget(webhook, workflow, event, request, {
      requestId: payload.requestId,
      path: webhook.path ?? undefined,
      receivedAt: payload.receivedAt,
      triggerTimestampMs: Date.parse(event.time),
    })
    if (result.outcome === 'queued') processed += 1
    else if (result.outcome === 'ignored') ignored += 1
    else failed += 1
  }

  if (failed > 0) {
    throw new Error(`Failed to dispatch ${failed} of ${page.targets.length} QuickBooks targets`)
  }

  logger.info(`[${payload.requestId}] QuickBooks webhook page completed`, {
    eventId: event.id,
    eventIndex,
    ignored,
    processed,
    targetCount: page.targets.length,
  })
  return {
    ignored,
    processed,
    targetCount: page.targets.length,
    ...(nextCursor ? { nextCursor } : {}),
  }
}

async function runQuickBooksWebhookIngressJob(
  payload: QuickBooksWebhookIngressPayload
): Promise<void> {
  const eventIndex = payload.eventIndex ?? 0
  const result = await executeQuickBooksWebhookIngress(payload)
  if (result.nextCursor) {
    await enqueueQuickBooksWebhookIngress({ ...payload, afterWebhookId: result.nextCursor })
    return
  }
  if (eventIndex + 1 < payload.events.length) {
    await enqueueQuickBooksWebhookIngress({
      ...payload,
      eventIndex: eventIndex + 1,
      afterWebhookId: undefined,
    })
  }
}

export async function enqueueQuickBooksWebhookIngress(
  payload: QuickBooksWebhookIngressPayload
): Promise<string> {
  const jobQueue = await getJobQueue()
  const eventIndex = payload.eventIndex ?? 0
  return jobQueue.enqueue('quickbooks-webhook-ingress', payload, {
    jobId: `quickbooks-webhook-ingress:${payload.requestId}:${eventIndex}:${payload.afterWebhookId ?? 'root'}`,
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
