import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Sendblue')

/**
 * Maps Sendblue trigger IDs to the expected value of the webhook payload's
 * `is_outbound` flag, used to route inbound vs. outbound status events.
 * The handler is the only runtime consumer, so the map lives here (single
 * source of truth) rather than crossing from the triggers graph into the
 * webhook-providers graph.
 */
const SENDBLUE_TRIGGER_IS_OUTBOUND: Record<string, boolean> = {
  sendblue_message_received: false,
  sendblue_message_status_updated: true,
}

/**
 * Sendblue webhook handler.
 *
 * No `verifyAuth` is implemented: Sendblue supports an optional per-webhook
 * `secret`/`globalSecret` that it "includes in the webhook request headers,"
 * but the official docs never name the header or specify whether the value is
 * a plain token echo or an HMAC signature. Implementing verification today
 * would require guessing the header name, so it is deferred. When Sendblue
 * documents the scheme, wire `verifyTokenAuth` (plain token) or
 * `createHmacVerifier` (HMAC) from `@/lib/webhooks/providers/utils` and add a
 * secret sub-block to the block definition.
 */
export const sendblueHandler: WebhookProviderHandler = {
  matchEvent({ body, webhook, requestId }: EventMatchContext): boolean {
    const providerConfig = getProviderConfig(webhook)
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || !(triggerId in SENDBLUE_TRIGGER_IS_OUTBOUND)) return true

    if (!isRecordLike(body)) {
      logger.warn(`[${requestId}] Sendblue webhook payload was not an object`)
      return false
    }

    const expected = SENDBLUE_TRIGGER_IS_OUTBOUND[triggerId]
    const isOutbound = body.is_outbound === true
    if (isOutbound !== expected) {
      logger.info(`[${requestId}] Sendblue event did not match trigger`, { triggerId, isOutbound })
      return false
    }

    return true
  },

  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null
    const handle = body.message_handle
    if (typeof handle !== 'string' || handle.length === 0) return null
    // A single outbound message emits multiple status callbacks (e.g. SENT then
    // DELIVERED) that share one message_handle, so the status is part of the key
    // to keep distinct transitions from being deduped as retries.
    const status = typeof body.status === 'string' && body.status.length > 0 ? body.status : null
    return status ? `${handle}:${status}` : handle
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    return {
      input: {
        account_email: b.accountEmail ?? b.account_email ?? null,
        content: b.content ?? null,
        media_url: (typeof b.media_url === 'string' && b.media_url) || null,
        is_outbound: b.is_outbound ?? null,
        status: b.status ?? null,
        error_code: b.error_code ?? null,
        error_message: b.error_message ?? null,
        error_reason: b.error_reason ?? null,
        error_detail: b.error_detail ?? null,
        message_handle: b.message_handle ?? null,
        date_sent: b.date_sent ?? null,
        date_updated: b.date_updated ?? null,
        from_number: b.from_number ?? null,
        number: b.number ?? null,
        to_number: b.to_number ?? null,
        was_downgraded: b.was_downgraded ?? null,
        plan: b.plan ?? null,
        message_type: b.message_type ?? null,
        group_id: (typeof b.group_id === 'string' && b.group_id) || null,
        participants: b.participants ?? [],
        send_style: b.send_style ?? null,
        opted_out: b.opted_out ?? null,
        sendblue_number: b.sendblue_number ?? null,
        service: b.service ?? null,
        group_display_name: b.group_display_name ?? null,
        sender_email: b.sender_email ?? null,
        seat_id: b.seat_id ?? null,
        raw: JSON.stringify(b),
      },
    }
  },
}
