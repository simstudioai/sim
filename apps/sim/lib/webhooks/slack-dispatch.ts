import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import {
  dispatchResolvedWebhookTarget,
  type findWebhooksByRoutingKey,
} from '@/lib/webhooks/processor'
import { resolveSlackEventKey } from '@/lib/webhooks/providers/slack'

const logger = createLogger('SlackWebhookDispatch')

interface DispatchSlackWebhooksOptions {
  body: unknown
  request: NextRequest
  requestId: string
  receivedAt: number
}

/**
 * Shared fan-out tail for the Slack ingest routes (native team-id route and the
 * custom-bot credential route): run each candidate webhook through the common
 * post-auth lifecycle (preprocess, deployment check, trigger filter, enqueue)
 * via {@link dispatchResolvedWebhookTarget}, logging skip diagnostics for
 * filtered events.
 */
export async function dispatchSlackWebhooks(
  webhooks: Awaited<ReturnType<typeof findWebhooksByRoutingKey>>,
  { body, request, requestId, receivedAt }: DispatchSlackWebhooksOptions
): Promise<void> {
  const payload = body as Record<string, unknown>
  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const parsedTimestampMs = slackRequestTimestamp ? Number(slackRequestTimestamp) * 1000 : undefined
  const triggerTimestampMs = Number.isFinite(parsedTimestampMs) ? parsedTimestampMs : undefined

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of webhooks) {
    const result = await dispatchResolvedWebhookTarget(foundWebhook, foundWorkflow, body, request, {
      requestId,
      receivedAt,
      triggerTimestampMs,
    })

    if (result.outcome === 'ignored' && result.reason === 'filtered') {
      const rawEvent = payload.event as Record<string, unknown> | undefined
      const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
      logger.info(`[${requestId}] Event skipped by trigger filter for webhook ${foundWebhook.id}`, {
        eventKey: resolveSlackEventKey(payload),
        configuredEvent: providerConfig.eventType,
        channelType: rawEvent?.channel_type,
        subtype: rawEvent?.subtype,
        isThreadReply:
          typeof rawEvent?.thread_ts === 'string' && rawEvent.thread_ts !== rawEvent.ts,
        threadsSetting: providerConfig.threads,
        botId: rawEvent?.bot_id,
      })
    }
  }
}
