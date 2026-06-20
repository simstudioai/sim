import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Zendesk')

function asRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>) || {}
}

/** Zendesk API base for a subdomain. */
function zendeskApiBase(subdomain: string): string {
  return `https://${subdomain}.zendesk.com/api/v2`
}

/** Basic auth header for the Zendesk API-token scheme (`email/token:apiToken`). */
function zendeskAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString('base64')}`
}

/** Best-effort delete used to avoid orphaning a webhook when post-create setup fails. */
async function deleteZendeskWebhookQuietly(
  apiBase: string,
  authHeader: string,
  webhookId: string
): Promise<void> {
  await fetch(`${apiBase}/webhooks/${webhookId}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader },
  }).catch(() => {})
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
      // The signing secret is fetched during auto-registration, so a missing
      // secret means misconfiguration — fail closed rather than skip.
      logger.warn(`[${requestId}] Zendesk webhook secret not configured`)
      return new NextResponse('Unauthorized - Missing Zendesk webhook secret', { status: 401 })
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

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const subdomain = config.subdomain as string | undefined
    const email = config.email as string | undefined
    const apiToken = config.apiToken as string | undefined
    const triggerId = config.triggerId as string | undefined

    if (!subdomain) throw new Error('Zendesk subdomain is required to create the webhook.')
    if (!email) throw new Error('Zendesk admin email is required to create the webhook.')
    if (!apiToken) throw new Error('Zendesk API token is required to create the webhook.')

    const { getZendeskSubscriptions } = await import('@/triggers/zendesk/utils')
    const apiBase = zendeskApiBase(subdomain)
    const authHeader = zendeskAuthHeader(email, apiToken)

    const createRes = await fetch(`${apiBase}/webhooks`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: {
          name: `Sim webhook (${ctx.webhook.id})`,
          endpoint: getNotificationUrl(ctx.webhook),
          http_method: 'POST',
          request_format: 'json',
          status: 'active',
          subscriptions: getZendeskSubscriptions(triggerId ?? 'zendesk_webhook'),
        },
      }),
    })

    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => '')
      logger.error(`[${ctx.requestId}] Failed to create Zendesk webhook (${createRes.status})`, {
        detail,
      })
      if (createRes.status === 401 || createRes.status === 403) {
        throw new Error(
          'Zendesk authentication failed. Verify the subdomain, admin email, and API token.'
        )
      }
      throw new Error(`Failed to create Zendesk webhook: ${createRes.status}`)
    }

    const created = asRecord((await createRes.json().catch(() => ({}))) as unknown)
    const externalId = asRecord(created.webhook).id as string | undefined
    if (!externalId) throw new Error('Zendesk webhook created but no webhook ID was returned.')

    const secretRes = await fetch(`${apiBase}/webhooks/${externalId}/signing_secret`, {
      headers: { Authorization: authHeader },
    })
    if (!secretRes.ok) {
      const detail = await secretRes.text().catch(() => '')
      logger.error(
        `[${ctx.requestId}] Created Zendesk webhook ${externalId} but failed to fetch signing secret (${secretRes.status})`,
        { detail }
      )
      // Avoid leaving an orphaned webhook in Zendesk when secret retrieval fails.
      await deleteZendeskWebhookQuietly(apiBase, authHeader, externalId)
      throw new Error(`Failed to fetch Zendesk signing secret: ${secretRes.status}`)
    }

    const secretBody = asRecord((await secretRes.json().catch(() => ({}))) as unknown)
    const secret = asRecord(secretBody.signing_secret).secret as string | undefined
    if (!secret) {
      await deleteZendeskWebhookQuietly(apiBase, authHeader, externalId)
      throw new Error('Zendesk did not return a signing secret for the webhook.')
    }

    logger.info(`[${ctx.requestId}] Created Zendesk webhook ${externalId}`)
    return { providerConfigUpdates: { externalId, webhookSecret: secret } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const subdomain = config.subdomain as string | undefined
    const email = config.email as string | undefined
    const apiToken = config.apiToken as string | undefined
    const externalId = config.externalId as string | undefined

    if (!subdomain || !email || !apiToken || !externalId) {
      if (ctx.strict) throw new Error('Missing Zendesk credentials or webhook ID for deletion.')
      logger.warn(
        `[${ctx.requestId}] Skipping Zendesk webhook cleanup — missing credentials or webhook ID`
      )
      return
    }

    const res = await fetch(`${zendeskApiBase(subdomain)}/webhooks/${externalId}`, {
      method: 'DELETE',
      headers: { Authorization: zendeskAuthHeader(email, apiToken) },
    })

    if (!res.ok && res.status !== 404) {
      if (ctx.strict) throw new Error(`Failed to delete Zendesk webhook: ${res.status}`)
      logger.warn(
        `[${ctx.requestId}] Failed to delete Zendesk webhook ${externalId} (non-fatal): ${res.status}`
      )
      return
    }
    logger.info(`[${ctx.requestId}] Deleted Zendesk webhook ${externalId}`)
  },
}
