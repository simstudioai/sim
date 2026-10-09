import { db, webhook, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
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

const logger = createLogger('WebhookProvider:Checkr')

const CHECKR_WEBHOOKS_URL = 'https://api.checkr.com/v1/webhooks'
const MAX_CHECKR_WEBHOOK_RESPONSE_BYTES = 1024 * 1024

function checkrAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function readCheckrResponse(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  try {
    const body = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_CHECKR_WEBHOOK_RESPONSE_BYTES,
      label,
    })
    return toRecord(body)
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error
    return {}
  }
}

function checkrErrorMessage(body: Record<string, unknown>): string | null {
  return typeof body.error === 'string' && body.error ? body.error : null
}

/**
 * Checkr signs each delivery with an HMAC-SHA256 hex digest of the compact JSON
 * body, keyed by the account's API key. The raw body is that compact JSON;
 * re-serializing is a fallback for a proxy that reformatted whitespace.
 */
function isValidCheckrSignature(apiKey: string, signature: string, rawBody: string): boolean {
  if (!apiKey || !signature || !rawBody) return false
  const expected = signature.trim().toLowerCase()
  if (safeCompare(hmacSha256Hex(rawBody, apiKey), expected)) return true
  try {
    const compact = JSON.stringify(JSON.parse(rawBody))
    return compact !== rawBody && safeCompare(hmacSha256Hex(compact, apiKey), expected)
  } catch {
    return false
  }
}

/**
 * Returns the ID of an existing Checkr webhook that already delivers full objects to this
 * callback URL. A redeploy prepares its replacement on the same callback path while the live
 * registration still exists, and Checkr caps an account at two webhooks, so the replacement
 * adopts the live registration instead of creating another.
 */
async function findCheckrWebhookForUrl(apiKey: string, url: string): Promise<string | null> {
  const response = await fetch(CHECKR_WEBHOOKS_URL, { headers: checkrAuthHeaders(apiKey) })
  if (!response.ok) return null
  const body = await readCheckrResponse(response, 'Checkr webhook list response')
  const match = toArray(body.data)
    .map((entry) => toRecord(entry))
    .find(
      (entry) => entry.webhook_url === url && entry.include_object === true && !entry.deleted_at
    )
  return typeof match?.id === 'string' && match.id ? match.id : null
}

/**
 * Whether another webhook row on an active deployment of this workflow uses the same Checkr
 * webhook, which happens after a redeploy adopts the live registration.
 */
async function activeDeploymentUsesCheckrWebhook(
  webhookRecord: Record<string, unknown>,
  externalId: string
): Promise<boolean> {
  const workflowId = webhookRecord.workflowId
  const webhookId = webhookRecord.id
  if (typeof workflowId !== 'string' || typeof webhookId !== 'string') return false

  const activeWebhooks = await db
    .select({ providerConfig: webhook.providerConfig })
    .from(webhook)
    .innerJoin(
      workflowDeploymentVersion,
      eq(webhook.deploymentVersionId, workflowDeploymentVersion.id)
    )
    .where(
      and(
        eq(webhook.workflowId, workflowId),
        ne(webhook.id, webhookId),
        eq(webhook.provider, 'checkr'),
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true),
        isNull(webhook.archivedAt)
      )
    )

  return activeWebhooks.some(
    (activeWebhook) =>
      getProviderConfig({ providerConfig: activeWebhook.providerConfig }).externalId === externalId
  )
}

export const checkrHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const apiKey = typeof providerConfig.apiKey === 'string' ? providerConfig.apiKey.trim() : ''
    if (!apiKey) {
      logger.warn(`[${requestId}] Checkr webhook has no API key configured — rejecting request`)
      return new NextResponse(
        'Unauthorized - Checkr API key is not configured. Add it to the trigger and redeploy.',
        { status: 401 }
      )
    }

    const signature = request.headers.get('x-checkr-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Checkr webhook missing X-Checkr-Signature header`)
      return new NextResponse('Unauthorized - Missing Checkr signature', { status: 401 })
    }

    if (!isValidCheckrSignature(apiKey, signature, rawBody)) {
      logger.warn(`[${requestId}] Checkr signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Checkr signature', { status: 401 })
    }

    return null
  },

  async matchEvent({
    webhook,
    body,
    requestId,
    providerConfig,
  }: EventMatchContext): Promise<boolean> {
    const triggerId = typeof providerConfig.triggerId === 'string' ? providerConfig.triggerId : ''
    if (!triggerId) return true

    const eventType = isRecordLike(body) && typeof body.type === 'string' ? body.type : ''
    const { isCheckrEventMatch } = await import('@/triggers/checkr/utils')
    if (!isCheckrEventMatch(triggerId, eventType)) {
      logger.debug(
        `[${requestId}] Checkr event ${eventType || '(missing)'} does not match trigger ${triggerId}. Skipping execution.`,
        { webhookId: webhook.id, triggerId }
      )
      return false
    }
    return true
  },

  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body) || typeof body.id !== 'string' || !body.id) return null
    return `checkr:${body.id}`
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const event = toRecord(body)
    const object = toRecord(toRecord(event.data).object)
    const triggerId = getProviderConfig(webhook).triggerId
    const { getCheckrResourceKey } = await import('@/triggers/checkr/utils')
    const resourceKey = typeof triggerId === 'string' ? getCheckrResourceKey(triggerId) : null

    return {
      input: {
        eventId: event.id ?? null,
        eventType: event.type ?? null,
        createdAt: event.created_at ?? null,
        accountId: event.account_id ?? null,
        objectType: object.object ?? null,
        objectId: object.id ?? null,
        ...(resourceKey ? { [resourceKey]: object } : { data: object }),
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const providerConfig = getProviderConfig(ctx.webhook)
    const apiKey = typeof providerConfig.apiKey === 'string' ? providerConfig.apiKey.trim() : ''
    if (!apiKey) {
      throw new Error('Checkr API key is required to register the webhook.')
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const existingId = await findCheckrWebhookForUrl(apiKey, notificationUrl)
    if (existingId) {
      logger.info(`[${ctx.requestId}] Reusing Checkr webhook ${existingId} for this callback URL`)
      return { providerConfigUpdates: { externalId: existingId } }
    }

    logger.info(`[${ctx.requestId}] Creating Checkr webhook`, {
      webhookId: ctx.webhook.id,
      triggerId: providerConfig.triggerId,
    })

    const response = await fetch(CHECKR_WEBHOOKS_URL, {
      method: 'POST',
      headers: checkrAuthHeaders(apiKey),
      body: JSON.stringify({
        webhook_url: notificationUrl,
        include_object: true,
        live: true,
      }),
    })
    const responseBody = await readCheckrResponse(response, 'Checkr webhook creation response')

    if (!response.ok) {
      const providerMessage = checkrErrorMessage(responseBody)
      let message = `Failed to register the webhook in Checkr (HTTP ${response.status})`
      if (response.status === 401) {
        message =
          'Invalid Checkr API key. Use a secret API key from Account Settings > Developer Settings.'
      } else if (response.status === 403) {
        message = 'This Checkr API key is not allowed to manage webhooks.'
      } else if (providerMessage && /limit/i.test(providerMessage)) {
        message =
          'Checkr allows at most two webhooks per account. Remove an unused webhook in Checkr under Account Settings > Developer Settings, or use the All Events trigger, then redeploy.'
      } else if (providerMessage) {
        message = `Checkr error: ${providerMessage}`
      }
      throw new Error(message)
    }

    const externalId = typeof responseBody.id === 'string' ? responseBody.id : ''
    if (!externalId) {
      throw new Error('Checkr created the webhook but did not return its ID.')
    }

    logger.info(`[${ctx.requestId}] Created Checkr webhook ${externalId}`)
    return { providerConfigUpdates: { externalId } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
      const externalId = typeof config.externalId === 'string' ? config.externalId : ''

      if (!apiKey || !externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing ${apiKey ? 'externalId' : 'apiKey'} for Checkr webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Checkr API key or webhook ID for deletion')
        return
      }

      if (await activeDeploymentUsesCheckrWebhook(ctx.webhook, externalId)) {
        logger.info(
          `[${ctx.requestId}] Keeping Checkr webhook ${externalId} because an active deployment still uses it`
        )
        return
      }

      const response = await fetch(`${CHECKR_WEBHOOKS_URL}/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
        headers: checkrAuthHeaders(apiKey),
      })

      if (response.ok) {
        logger.info(`[${ctx.requestId}] Deleted Checkr webhook ${externalId}`)
        return
      }
      if (response.status === 404) {
        logger.info(`[${ctx.requestId}] Checkr webhook ${externalId} was already removed`)
        return
      }

      const responseBody = await readCheckrResponse(response, 'Checkr webhook deletion response')
      const message = checkrErrorMessage(responseBody) ?? `HTTP ${response.status}`
      logger.warn(`[${ctx.requestId}] Failed to delete Checkr webhook (non-fatal): ${message}`, {
        status: response.status,
      })
      if (ctx.strict) throw new Error(`Failed to delete Checkr webhook: ${message}`)
    } catch (error) {
      logger.warn(
        `[${ctx.requestId}] Error deleting Checkr webhook (non-fatal): ${getErrorMessage(error)}`
      )
      if (ctx.strict) throw error
    }
  },
}
