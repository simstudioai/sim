import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:PagerDuty')

/**
 * PagerDuty V3 signs the raw body with HMAC-SHA256 and sends it in the
 * `X-PagerDuty-Signature` header as one or more comma-separated `v1=<hex>`
 * values (multiple appear during signing-secret rotation). The delivery is
 * valid when our computed signature matches any of them.
 */
function validatePagerDutySignature(secret: string, signature: string, body: string): boolean {
  if (!secret || !signature || !body) return false
  const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return signature
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .some((part) => safeCompare(part.slice(3), computed))
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

function referenceSummary(
  value: unknown
): { id?: unknown; summary?: unknown; html_url?: unknown } | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Record<string, unknown>
  return { id: ref.id, summary: ref.summary, html_url: ref.html_url }
}

export const pagerdutyHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-PagerDuty-Signature',
    validateFn: validatePagerDutySignature,
    providerLabel: 'PagerDuty',
  }),

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'pagerduty_webhook') return true

    const event = asRecord(asRecord(body).event)
    const eventType = event.event_type as string | undefined

    const { isPagerDutyEventMatch } = await import('@/triggers/pagerduty/utils')
    if (!isPagerDutyEventMatch(triggerId, eventType || '')) {
      logger.debug(
        `[${requestId}] PagerDuty event '${eventType}' does not match trigger ${triggerId}, skipping`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const event = asRecord(asRecord(body).event)
    const data = asRecord(event.data)
    const priority = referenceSummary(data.priority)

    return {
      input: {
        event_id: event.id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        agent: event.agent ?? null,
        incident: {
          id: data.id,
          number: data.number,
          title: data.title,
          status: data.status,
          urgency: data.urgency,
          html_url: data.html_url,
          created_at: data.created_at,
          priority: priority?.summary ?? null,
          service: referenceSummary(data.service),
          escalation_policy: referenceSummary(data.escalation_policy),
          assignees: Array.isArray(data.assignees) ? data.assignees : [],
        },
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const event = asRecord(asRecord(body).event)
    return (event.id as string | undefined) || null
  },
}
