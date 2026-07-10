import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { NextRequest } from 'next/server'
import type { TikTokWebhookEnvelope } from '@/lib/api/contracts/webhooks'
import { dispatchResolvedWebhookTarget } from '@/lib/webhooks/processor'
import { findTikTokWebhookTargets } from '@/lib/webhooks/providers/tiktok-targets'

const logger = createLogger('TikTokWebhookIngressTask')

export const TIKTOK_WEBHOOK_INGRESS_CONCURRENCY_LIMIT = 50
export const TIKTOK_WEBHOOK_INGRESS_MAX_ATTEMPTS = 3

export interface TikTokWebhookIngressPayload {
  envelope: TikTokWebhookEnvelope
  headers: {
    'content-type': string
  }
  requestId: string
  receivedAt: number
}

export interface TikTokWebhookIngressResult {
  ignored: number
  processed: number
  targetCount: number
}

/**
 * Resolves and dispatches all active workflow targets for one verified TikTok delivery. Throwing
 * after any retryable target failure lets Trigger.dev replay the fanout; workflow-level
 * idempotency prevents already-queued targets from executing twice.
 */
export async function executeTikTokWebhookIngress(
  payload: TikTokWebhookIngressPayload
): Promise<TikTokWebhookIngressResult> {
  const targets = await findTikTokWebhookTargets(payload.envelope.user_openid, payload.requestId)
  if (targets.length === 0) {
    logger.info(`[${payload.requestId}] No TikTok webhook targets found`, {
      event: payload.envelope.event,
      userOpenIdPrefix: payload.envelope.user_openid.slice(0, 12),
    })
    return { ignored: 0, processed: 0, targetCount: 0 }
  }

  const request = new NextRequest('http://internal/api/webhooks/tiktok', {
    method: 'POST',
    headers: payload.headers,
    body: JSON.stringify(payload.envelope),
  })

  let ignored = 0
  let processed = 0
  let failed = 0

  for (const { webhook, workflow } of targets) {
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
    throw new Error(`Failed to dispatch ${failed} of ${targets.length} TikTok webhook targets`)
  }

  logger.info(`[${payload.requestId}] TikTok webhook fanout completed`, {
    event: payload.envelope.event,
    ignored,
    processed,
    targetCount: targets.length,
  })

  return { ignored, processed, targetCount: targets.length }
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
  run: async (payload: TikTokWebhookIngressPayload) => executeTikTokWebhookIngress(payload),
})
