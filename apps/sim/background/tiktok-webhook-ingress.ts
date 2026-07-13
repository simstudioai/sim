import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { NextRequest } from 'next/server'
import type { TikTokWebhookEnvelope } from '@/lib/api/contracts/webhooks'
import { getJobQueue } from '@/lib/core/async-jobs'
import { dispatchResolvedWebhookTarget } from '@/lib/webhooks/processor'
import { findTikTokWebhookTargetPage } from '@/lib/webhooks/providers/tiktok-targets'

const logger = createLogger('TikTokWebhookIngressTask')

export const TIKTOK_WEBHOOK_INGRESS_CONCURRENCY_LIMIT = 50
export const TIKTOK_WEBHOOK_INGRESS_MAX_ATTEMPTS = 3

export interface TikTokWebhookIngressPayload {
  afterWebhookId?: string
  envelope: TikTokWebhookEnvelope
  headers: {
    'content-type': string
  }
  requestId: string
  receivedAt: number
}

export interface TikTokWebhookIngressResult {
  ignored: number
  nextCursor?: string
  processed: number
  targetCount: number
}

/**
 * Resolves and dispatches one fixed-size keyset page for a verified TikTok delivery. Each page is a
 * separate durable job, so retries replay at most one bounded page and successful pages continue
 * from their last webhook ID.
 */
export async function executeTikTokWebhookIngress(
  payload: TikTokWebhookIngressPayload
): Promise<TikTokWebhookIngressResult> {
  const request = new NextRequest('http://internal/api/webhooks/tiktok', {
    method: 'POST',
    headers: payload.headers,
    body: JSON.stringify(payload.envelope),
  })

  const page = await findTikTokWebhookTargetPage(
    payload.envelope.user_openid,
    payload.requestId,
    payload.afterWebhookId
  )
  const nextCursor = page.hasMore ? page.nextCursor : null
  if (page.hasMore && (!nextCursor || nextCursor === payload.afterWebhookId)) {
    throw new Error('TikTok webhook target pagination did not advance')
  }

  let ignored = 0
  let processed = 0
  let failed = 0
  const targetCount = page.targets.length

  for (const { webhook, workflow } of page.targets) {
    const result = await dispatchResolvedWebhookTarget(
      webhook,
      workflow,
      payload.envelope,
      request,
      {
        requestId: payload.requestId,
        path: webhook.path ?? undefined,
        receivedAt: payload.receivedAt,
        triggerTimestampMs: payload.envelope.create_time * 1000,
      }
    )

    if (result.outcome === 'queued') {
      processed += 1
    } else if (result.outcome === 'ignored') {
      ignored += 1
    } else {
      failed += 1
    }
  }

  if (failed > 0) {
    throw new Error(`Failed to dispatch ${failed} of ${targetCount} TikTok webhook targets`)
  }

  if (targetCount === 0) {
    logger.info(`[${payload.requestId}] No TikTok webhook targets found in page`, {
      event: payload.envelope.event,
      userOpenIdPrefix: payload.envelope.user_openid.slice(0, 12),
    })
    return {
      ignored: 0,
      processed: 0,
      targetCount: 0,
      ...(nextCursor ? { nextCursor } : {}),
    }
  }

  logger.info(`[${payload.requestId}] TikTok webhook fanout page completed`, {
    event: payload.envelope.event,
    ignored,
    nextCursor,
    processed,
    targetCount,
  })

  return { ignored, processed, targetCount, ...(nextCursor ? { nextCursor } : {}) }
}

async function runTikTokWebhookIngressJob(payload: TikTokWebhookIngressPayload): Promise<void> {
  const result = await executeTikTokWebhookIngress(payload)
  if (!result.nextCursor) return

  await enqueueTikTokWebhookIngress({
    ...payload,
    afterWebhookId: result.nextCursor,
  })
}

/** Enqueues one bounded TikTok webhook fanout page with stable continuation identity. */
export async function enqueueTikTokWebhookIngress(
  payload: TikTokWebhookIngressPayload
): Promise<string> {
  const jobQueue = await getJobQueue()
  return jobQueue.enqueue('tiktok-webhook-ingress', payload, {
    jobId: `tiktok-webhook-ingress:${payload.requestId}:${payload.afterWebhookId ?? 'root'}`,
    maxAttempts: TIKTOK_WEBHOOK_INGRESS_MAX_ATTEMPTS,
    concurrencyKey: 'tiktok-webhook-ingress',
    concurrencyLimit: TIKTOK_WEBHOOK_INGRESS_CONCURRENCY_LIMIT,
    runner: async () => runTikTokWebhookIngressJob(payload),
  })
}

export const tiktokWebhookIngressTask = task({
  id: 'tiktok-webhook-ingress',
  machine: 'small-1x',
  retry: {
    maxAttempts: TIKTOK_WEBHOOK_INGRESS_MAX_ATTEMPTS,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
  },
  queue: {
    concurrencyLimit: TIKTOK_WEBHOOK_INGRESS_CONCURRENCY_LIMIT,
  },
  run: async (payload: TikTokWebhookIngressPayload) => runTikTokWebhookIngressJob(payload),
})
