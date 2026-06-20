import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:PagerDuty')

const PAGERDUTY_API_BASE = 'https://api.pagerduty.com'

/** Shared headers for PagerDuty REST API calls (the v2 Accept header is required). */
function pagerdutyHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Token token=${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.pagerduty+json;version=2',
  }
}

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

/**
 * Best-effort cleanup of a webhook subscription after a failed setup. Deletes by
 * id when known, otherwise finds the subscription pointing at `url` and deletes
 * it, so a created subscription is never orphaned in PagerDuty.
 */
async function cleanupPagerDutySubscription(
  apiKey: string,
  url: string,
  subscriptionId?: string
): Promise<void> {
  let id = subscriptionId
  if (!id) {
    const listRes = await fetch(`${PAGERDUTY_API_BASE}/webhook_subscriptions`, {
      headers: pagerdutyHeaders(apiKey),
    }).catch(() => null)
    if (!listRes || !listRes.ok) return
    const body = (await listRes.json().catch(() => null)) as {
      webhook_subscriptions?: Array<{ id?: string; delivery_method?: { url?: string } }>
    } | null
    id = body?.webhook_subscriptions?.find((sub) => sub.delivery_method?.url === url)?.id
  }
  if (!id) return
  await fetch(`${PAGERDUTY_API_BASE}/webhook_subscriptions/${id}`, {
    method: 'DELETE',
    headers: pagerdutyHeaders(apiKey),
  }).catch(() => null)
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
    // The signing secret is captured during auto-registration, so a missing
    // secret means misconfiguration — fail closed rather than skip verification.
    requireSecret: true,
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

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const apiKey = config.apiKey as string | undefined
    const triggerId = config.triggerId as string | undefined

    if (!apiKey)
      throw new Error('PagerDuty API Key is required to create the webhook subscription.')

    const { getPagerDutyEvents } = await import('@/triggers/pagerduty/utils')
    const res = await fetch(`${PAGERDUTY_API_BASE}/webhook_subscriptions`, {
      method: 'POST',
      headers: pagerdutyHeaders(apiKey),
      body: JSON.stringify({
        webhook_subscription: {
          type: 'webhook_subscription',
          delivery_method: { type: 'http_delivery_method', url: getNotificationUrl(ctx.webhook) },
          events: getPagerDutyEvents(triggerId ?? 'pagerduty_webhook'),
          filter: { type: 'account_reference' },
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      logger.error(`[${ctx.requestId}] Failed to create PagerDuty webhook (${res.status})`, {
        detail,
      })
      if (res.status === 401)
        throw new Error('PagerDuty authentication failed. Verify your REST API key.')
      if (res.status === 403)
        throw new Error('PagerDuty access denied. The API key must have read/write access.')
      throw new Error(`Failed to create PagerDuty webhook subscription: ${res.status}`)
    }

    const created = asRecord((await res.json().catch(() => ({}))) as unknown)
    const subscription = asRecord(created.webhook_subscription)
    const externalId = subscription.id as string | undefined
    const secret = asRecord(subscription.delivery_method).secret as string | undefined

    // The subscription exists once PagerDuty returns success; if it is missing
    // its id or signing secret, delete it so it is not orphaned, then fail.
    if (!externalId || !secret) {
      await cleanupPagerDutySubscription(apiKey, getNotificationUrl(ctx.webhook), externalId)
      if (!externalId) {
        throw new Error('PagerDuty webhook created but no subscription ID was returned.')
      }
      throw new Error('PagerDuty webhook created but no signing secret was returned on creation.')
    }

    logger.info(`[${ctx.requestId}] Created PagerDuty webhook subscription ${externalId}`)
    return { providerConfigUpdates: { externalId, webhookSecret: secret } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const apiKey = config.apiKey as string | undefined
    const externalId = config.externalId as string | undefined

    if (!apiKey || !externalId) {
      if (ctx.strict) throw new Error('Missing PagerDuty API key or subscription ID for deletion.')
      logger.warn(
        `[${ctx.requestId}] Skipping PagerDuty webhook cleanup — missing API key or subscription ID`
      )
      return
    }

    const res = await fetch(`${PAGERDUTY_API_BASE}/webhook_subscriptions/${externalId}`, {
      method: 'DELETE',
      headers: pagerdutyHeaders(apiKey),
    })

    if (!res.ok && res.status !== 404) {
      if (ctx.strict) throw new Error(`Failed to delete PagerDuty webhook: ${res.status}`)
      logger.warn(
        `[${ctx.requestId}] Failed to delete PagerDuty webhook ${externalId} (non-fatal): ${res.status}`
      )
      return
    }
    logger.info(`[${ctx.requestId}] Deleted PagerDuty webhook subscription ${externalId}`)
  },
}
