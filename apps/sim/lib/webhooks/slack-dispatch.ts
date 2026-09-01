import type { ExternalUserSubject } from '@sim/auth/principal'
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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Extracts the Slack-attested human actor after request-signature verification. */
export function resolveSlackExternalUserSubject(body: unknown): ExternalUserSubject | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const payload = body as Record<string, unknown>
  const event =
    payload.event && typeof payload.event === 'object' && !Array.isArray(payload.event)
      ? (payload.event as Record<string, unknown>)
      : undefined
  const interactionUser =
    payload.user && typeof payload.user === 'object' && !Array.isArray(payload.user)
      ? (payload.user as Record<string, unknown>)
      : undefined
  const interactionTeam =
    payload.team && typeof payload.team === 'object' && !Array.isArray(payload.team)
      ? (payload.team as Record<string, unknown>)
      : undefined

  const eventIsBot = Boolean(
    event?.bot_id || event?.bot_profile || event?.subtype === 'bot_message'
  )
  const subjectId = eventIsBot
    ? undefined
    : (nonEmptyString(event?.user) ??
      nonEmptyString(interactionUser?.id) ??
      nonEmptyString(payload.user_id))
  const tenantId = event
    ? (nonEmptyString(event.user_team) ?? nonEmptyString(payload.team_id))
    : (nonEmptyString(interactionUser?.team_id) ??
      nonEmptyString(interactionTeam?.id) ??
      nonEmptyString(payload.team_id))

  if (!subjectId || !tenantId) return undefined
  return { kind: 'external_user', provider: 'slack', tenantId, subjectId }
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
  const subject = resolveSlackExternalUserSubject(body)

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
          subject,
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
