import { createLogger } from '@sim/logger'
import { getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Sendblue')

/**
 * Maps Sendblue trigger IDs to the expected value of the payload `is_outbound`
 * flag. Inbound messages are routed to the "message received" trigger and
 * outbound status callbacks to the "message status updated" trigger.
 */
const TRIGGER_IS_OUTBOUND: Record<string, boolean> = {
  sendblue_message_received: false,
  sendblue_message_status_updated: true,
}

export const sendblueHandler: WebhookProviderHandler = {
  matchEvent({ body, webhook, requestId }: EventMatchContext): boolean {
    const providerConfig = getProviderConfig(webhook)
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || !(triggerId in TRIGGER_IS_OUTBOUND)) return true

    if (!isRecord(body)) {
      logger.warn(`[${requestId}] Sendblue webhook payload was not an object`)
      return false
    }

    const expected = TRIGGER_IS_OUTBOUND[triggerId]
    const isOutbound = body.is_outbound === true
    if (isOutbound !== expected) {
      logger.info(`[${requestId}] Sendblue event did not match trigger`, { triggerId, isOutbound })
      return false
    }

    return true
  },

  extractIdempotencyId(body: unknown): string | null {
    if (!isRecord(body)) return null
    const handle = body.message_handle
    return typeof handle === 'string' && handle.length > 0 ? handle : null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecord(body) ? body : {}
    return {
      input: {
        accountEmail: b.accountEmail ?? b.account_email ?? null,
        content: b.content ?? null,
        media_url: b.media_url ?? null,
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
        group_id: b.group_id ?? null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
