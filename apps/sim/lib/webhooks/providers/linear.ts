import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
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
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Linear')

function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Linear signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = hmacSha256Hex(body, secret)
    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

/**
 * Linear's docs recommend a 60s window ("Reject any webhooks not within 60 seconds of the
 * current time to prevent replay attacks") but do NOT document whether `webhookTimestamp` is
 * re-stamped per delivery attempt or fixed to the original event time. Linear's own retry policy
 * resends failed deliveries after 1 minute, 1 hour, and 6 hours (@see
 * https://linear.app/developers/webhooks) — if the timestamp is fixed rather than refreshed per
 * attempt, a strict 60s window would silently and permanently drop every legitimate 1hr/6hr retry
 * following any transient outage on our side, since Linear gives up after 3 failed attempts.
 * We keep a wider 5-minute window: idempotency dedup (Linear-Delivery header / extractIdempotencyId
 * fallback below) already prevents double-processing of any replayed or retried delivery within
 * that window, so the incremental replay-protection benefit of matching Linear's 60s suggestion
 * literally is marginal compared to the risk of dropping real business events.
 */
const LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

const verifyLinearSignature = createHmacVerifier({
  configKey: 'webhookSecret',
  headerName: 'Linear-Signature',
  validateFn: validateLinearSignature,
  providerLabel: 'Linear',
})

export const linearHandler: WebhookProviderHandler = {
  async verifyAuth(ctx: AuthContext): Promise<NextResponse | null> {
    const { rawBody, requestId, providerConfig } = ctx
    if (!providerConfig.webhookSecret) {
      return null
    }

    const signatureError = await verifyLinearSignature(ctx)
    if (signatureError) return signatureError

    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      const ts = parsed.webhookTimestamp
      if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        logger.warn(`[${requestId}] Linear webhookTimestamp missing or invalid`)
        return new NextResponse('Unauthorized - Invalid webhook timestamp', {
          status: 401,
        })
      }

      if (Math.abs(Date.now() - ts) > LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS) {
        logger.warn(
          `[${requestId}] Linear webhookTimestamp outside allowed skew (${LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS}ms)`
        )
        return new NextResponse('Unauthorized - Webhook timestamp skew too large', {
          status: 401,
        })
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Linear webhook body parse failed after signature verification`,
        error
      )
      return new NextResponse('Unauthorized - Invalid webhook body', { status: 401 })
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    const rawActor = b.actor
    let actor: unknown = null
    if (rawActor && typeof rawActor === 'object' && !Array.isArray(rawActor)) {
      const a = rawActor as Record<string, unknown>
      const { type: linearActorType, ...rest } = a
      actor = {
        ...rest,
        actorType: typeof linearActorType === 'string' ? linearActorType : null,
      }
    }

    return {
      input: {
        action: b.action || '',
        type: b.type || '',
        webhookId: b.webhookId || '',
        webhookTimestamp: b.webhookTimestamp || 0,
        organizationId: b.organizationId || '',
        createdAt: b.createdAt || '',
        url: typeof b.url === 'string' ? b.url : '',
        actor,
        data: b.data || null,
        updatedFrom: b.updatedFrom || null,
      },
    }
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId && !triggerId.endsWith('_webhook') && !triggerId.endsWith('_webhook_v2')) {
      const { isLinearEventMatch } = await import('@/triggers/linear/utils')
      const obj = isRecordLike(body) ? body : {}
      const action = typeof obj.action === 'string' ? obj.action : undefined
      const type = typeof obj.type === 'string' ? obj.type : undefined
      if (!isLinearEventMatch(triggerId, type || '', action)) {
        logger.debug(
          `[${requestId}] Linear event mismatch for trigger ${triggerId}. Type: ${type}, Action: ${action}. Skipping.`
        )
        return false
      }
    }
    return true
  },

  /**
   * Fallback for dedup when the `Linear-Delivery` header (already handled generically by the
   * idempotency service) is unavailable. Keys on the entity id plus its own updatedAt/createdAt,
   * not a request-time timestamp, so retried deliveries of the same event still collapse.
   */
  extractIdempotencyId(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null

    const b = body as Record<string, unknown>
    const type = typeof b.type === 'string' ? b.type : undefined
    const action = typeof b.action === 'string' ? b.action : undefined
    const data = b.data as Record<string, unknown> | undefined
    const id = typeof data?.id === 'string' ? data.id : undefined
    if (!type || !id) {
      return null
    }
    const version = data?.updatedAt || data?.createdAt || b.createdAt
    return [`linear:${type}`, action, id, version].filter(Boolean).join(':')
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const triggerId = config.triggerId as string | undefined

    if (!triggerId || !triggerId.endsWith('_v2')) {
      return undefined
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      logger.warn(`[${ctx.requestId}] Missing API key for Linear webhook ${ctx.webhook.id}`)
      throw new Error(
        'Linear API key is required. Please provide a valid API key in the trigger configuration.'
      )
    }

    const { LINEAR_RESOURCE_TYPE_MAP } = await import('@/triggers/linear/utils')
    const resourceTypes = LINEAR_RESOURCE_TYPE_MAP[triggerId]
    if (!resourceTypes) {
      logger.warn(`[${ctx.requestId}] Unknown Linear trigger ID: ${triggerId}`)
      throw new Error(`Unknown Linear trigger type: ${triggerId}`)
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const webhookSecret = generateId()
    const teamId = config.teamId as string | undefined

    const input: Record<string, unknown> = {
      url: notificationUrl,
      resourceTypes,
      secret: webhookSecret,
      enabled: true,
    }

    if (teamId) {
      input.teamId = teamId
    } else {
      input.allPublicTeams = true
    }

    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          query: `mutation WebhookCreate($input: WebhookCreateInput!) {
            webhookCreate(input: $input) {
              success
              webhook { id enabled }
            }
          }`,
          variables: { input },
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Linear API returned HTTP ${response.status}. Please verify your API key and try again.`
        )
      }

      const data = await response.json()
      const result = data?.data?.webhookCreate

      if (!result?.success) {
        const errors = data?.errors?.map((e: { message: string }) => e.message).join(', ')
        logger.error(`[${ctx.requestId}] Failed to create Linear webhook`, {
          errors,
          webhookId: ctx.webhook.id,
        })
        throw new Error(errors || 'Failed to create Linear webhook. Please verify your API key.')
      }

      const externalId = result.webhook?.id
      if (typeof externalId !== 'string' || !externalId.trim()) {
        throw new Error(
          'Linear webhook was created but the API response did not include a webhook id.'
        )
      }

      logger.info(
        `[${ctx.requestId}] Created Linear webhook ${externalId} for webhook ${ctx.webhook.id}`
      )

      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret,
        },
      }
    } catch (error) {
      if (error instanceof Error && error.message !== 'fetch failed') {
        throw error
      }
      logger.error(`[${ctx.requestId}] Error creating Linear webhook`, {
        error: toError(error).message,
      })
      throw new Error('Failed to create Linear webhook. Please verify your API key and try again.')
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const triggerId = config.triggerId as string | undefined
    if (!triggerId || !triggerId.endsWith('_v2')) {
      return
    }

    const externalId = config.externalId as string | undefined
    const apiKey = config.apiKey as string | undefined

    if (!externalId || !apiKey) {
      if (ctx.strict) throw new Error('Missing Linear webhook deletion credentials')
      return
    }

    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          query: `mutation WebhookDelete($id: String!) {
            webhookDelete(id: $id) { success }
          }`,
          variables: { id: externalId },
        }),
      })

      if (!response.ok) {
        logger.warn(
          `[${ctx.requestId}] Linear API returned HTTP ${response.status} during webhook deletion for ${externalId}`
        )
        if (ctx.strict) throw new Error(`Linear webhook deletion failed: ${response.status}`)
        return
      }

      const data = await response.json()
      if (data?.data?.webhookDelete?.success) {
        logger.info(
          `[${ctx.requestId}] Deleted Linear webhook ${externalId} for webhook ${ctx.webhook.id}`
        )
      } else {
        const errorMessages = getGraphQLErrorMessages(data)
        if (errorMessages.some(isAlreadyAbsentWebhookMessage)) {
          logger.info(
            `[${ctx.requestId}] Linear webhook ${externalId} was already absent during deletion`
          )
          return
        }

        logger.warn(
          `[${ctx.requestId}] Linear webhook deletion returned unsuccessful for ${externalId}`
        )
        if (ctx.strict) throw new Error('Linear webhook deletion returned unsuccessful')
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Linear webhook ${externalId} (non-fatal)`, {
        error: toError(error).message,
      })
      if (ctx.strict) throw error
    }
  },
}

function getGraphQLErrorMessages(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const errors = (data as Record<string, unknown>).errors
  if (!Array.isArray(errors)) return []

  return errors
    .map((error) => {
      if (!error || typeof error !== 'object' || Array.isArray(error)) return null
      const message = (error as Record<string, unknown>).message
      return typeof message === 'string' ? message : null
    })
    .filter((message): message is string => Boolean(message))
}

function isAlreadyAbsentWebhookMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('not found') ||
    normalized.includes('not_found') ||
    normalized.includes('does not exist') ||
    normalized.includes('already deleted')
  )
}
