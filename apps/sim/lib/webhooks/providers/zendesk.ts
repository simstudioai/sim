import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Zendesk')

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

/** Maximum allowed clock skew (5 minutes) between Zendesk's signed timestamp and now, per Zendesk docs. */
const ZENDESK_TIMESTAMP_MAX_SKEW_MS = 5 * 60 * 1000

/**
 * Verify the signed timestamp is recent to prevent replay of captured deliveries.
 * Zendesk sends `X-Zendesk-Webhook-Signature-Timestamp` as an ISO-8601 string
 * (e.g. `2025-01-24T15:30:00.000Z`), so it is parsed with `Date.parse`.
 */
function isZendeskTimestampFresh(timestamp: string): boolean {
  const signedAt = Date.parse(timestamp)
  if (Number.isNaN(signedAt)) return false
  return Math.abs(Date.now() - signedAt) <= ZENDESK_TIMESTAMP_MAX_SKEW_MS
}

/**
 * Zendesk signs `timestamp + rawBody` (no separator) with HMAC-SHA256 keyed by
 * the webhook's signing secret, then base64-encodes it into
 * `X-Zendesk-Webhook-Signature`. The timestamp is sent in a separate header.
 */
function validateZendeskSignature(
  secret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  if (!secret || !signature || !timestamp) return false
  const computed = crypto
    .createHmac('sha256', secret)
    .update(timestamp + body, 'utf8')
    .digest('base64')
  return safeCompare(computed, signature)
}

export const zendeskHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const signature = request.headers.get('X-Zendesk-Webhook-Signature')
    const timestamp = request.headers.get('X-Zendesk-Webhook-Signature-Timestamp')
    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Zendesk webhook missing signature headers`)
      return new NextResponse('Unauthorized - Missing Zendesk signature', { status: 401 })
    }

    if (!isZendeskTimestampFresh(timestamp)) {
      logger.warn(`[${requestId}] Zendesk webhook timestamp outside the allowed window`, {
        timestamp,
      })
      return new NextResponse('Unauthorized - Stale Zendesk timestamp', { status: 401 })
    }

    if (!validateZendeskSignature(secret, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Zendesk signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Zendesk signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'zendesk_webhook') return true

    const eventType = asRecord(body).type as string | undefined

    const { isZendeskEventMatch } = await import('@/triggers/zendesk/utils')
    if (!isZendeskEventMatch(triggerId, eventType || '')) {
      logger.debug(
        `[${requestId}] Zendesk event '${eventType}' does not match trigger ${triggerId}, skipping`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = asRecord(body)
    const detail = asRecord(b.detail)
    const via = asRecord(detail.via)

    return {
      input: {
        event_id: b.id,
        event_type: b.type,
        time: b.time,
        account_id: b.account_id,
        ticket: {
          id: detail.id,
          subject: detail.subject,
          status: detail.status,
          priority: detail.priority,
          ticket_type: detail.type,
          description: detail.description,
          requester_id: detail.requester_id,
          assignee_id: detail.assignee_id,
          group_id: detail.group_id,
          organization_id: detail.organization_id,
          tags: Array.isArray(detail.tags) ? detail.tags : [],
          via_channel: via.channel,
          is_public: detail.is_public,
          created_at: detail.created_at,
          updated_at: detail.updated_at,
        },
        event: b.event ?? null,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    return (asRecord(body).id as string | undefined) || null
  },
}
