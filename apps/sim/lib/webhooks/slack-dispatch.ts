import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  dispatchResolvedWebhookTarget,
  type findWebhooksByRoutingKey,
  type WebhookDispatchResult,
} from '@/lib/webhooks/processor'
import { resolveSlackEventKey } from '@/lib/webhooks/providers/slack'

const logger = createLogger('SlackWebhookDispatch')
const SLACK_WEBHOOK_DISPATCH_CONCURRENCY = 10

interface DispatchSlackWebhooksOptions {
  body: unknown
  request: NextRequest
  requestId: string
  receivedAt: number
}

/** Returns the non-success response that tells Slack to retry a failed delivery. */
export function getSlackDispatchFailureResponse(result: WebhookDispatchResult): NextResponse {
  if (result.outcome !== 'failed') {
    throw new Error(`Expected failed Slack dispatch, received ${result.outcome}`)
  }
  if (result.response.ok) {
    throw new Error(
      `Failed Slack dispatch returned successful HTTP status ${result.response.status}`
    )
  }
  return result.response
}

/** Reduces a Slack fan-out to one provider acknowledgment or retry response. */
export function getSlackDispatchResponse(results: WebhookDispatchResult[]): NextResponse {
  const acknowledged = results.some(
    (result) => result.outcome !== 'failed' && result.reason !== 'block-missing'
  )
  if (acknowledged) {
    return new NextResponse(null, { status: 200 })
  }

  const failure = results.find((result) => result.outcome === 'failed')
  if (failure) {
    return getSlackDispatchFailureResponse(failure)
  }

  return new NextResponse(null, { status: 200 })
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
): Promise<WebhookDispatchResult[]> {
  const payload = body as Record<string, unknown>
  const slackRequestTimestamp = request.headers.get('x-slack-request-timestamp')
  const parsedTimestampMs = slackRequestTimestamp ? Number(slackRequestTimestamp) * 1000 : undefined
  const triggerTimestampMs = Number.isFinite(parsedTimestampMs) ? parsedTimestampMs : undefined
  return mapWithConcurrency(
    webhooks,
    SLACK_WEBHOOK_DISPATCH_CONCURRENCY,
    async ({ webhook: foundWebhook, workflow: foundWorkflow }) => {
      const result = await dispatchResolvedWebhookTarget(
        foundWebhook,
        foundWorkflow,
        body,
        request,
        {
          requestId,
          receivedAt,
          triggerTimestampMs,
        }
      )

      if (result.outcome === 'ignored' && result.reason === 'filtered') {
        const rawEvent = payload.event as Record<string, unknown> | undefined
        const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
        logger.info(
          `[${requestId}] Event skipped by trigger filter for webhook ${foundWebhook.id}`,
          {
            eventKey: resolveSlackEventKey(payload),
            configuredEvent: providerConfig.eventType,
            channelType: rawEvent?.channel_type,
            subtype: rawEvent?.subtype,
            isThreadReply:
              typeof rawEvent?.thread_ts === 'string' && rawEvent.thread_ts !== rawEvent.ts,
            threadsSetting: providerConfig.threads,
            botId: rawEvent?.bot_id,
          }
        )
      }

      return result
    }
  )
}
