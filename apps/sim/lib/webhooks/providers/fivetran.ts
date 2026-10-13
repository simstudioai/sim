import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import { generateRandomHex } from '@sim/utils/random'
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
import { buildFallbackDeliveryFingerprint } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Fivetran')

const FIVETRAN_WEBHOOKS_URL = 'https://api.fivetran.com/v1/webhooks'
const MAX_FIVETRAN_WEBHOOK_RESPONSE_BYTES = 1024 * 1024
const FIVETRAN_REQUEST_TIMEOUT_MS = 30_000

interface FivetranCredentials {
  apiKey: string
  apiSecret: string
}

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readCredentials(config: Record<string, unknown>): FivetranCredentials | null {
  const apiKey = readString(config, 'apiKey')
  const apiSecret = readString(config, 'apiSecret')
  return apiKey && apiSecret ? { apiKey, apiSecret } : null
}

function fivetranAuthHeaders({ apiKey, apiSecret }: FivetranCredentials): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function fivetranRequest(
  credentials: FivetranCredentials,
  url: string,
  method: string,
  body?: Record<string, unknown>
): Promise<Response> {
  return fetch(url, {
    method,
    headers: fivetranAuthHeaders(credentials),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FIVETRAN_REQUEST_TIMEOUT_MS),
  })
}

async function readFivetranResponse(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  try {
    const body = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_FIVETRAN_WEBHOOK_RESPONSE_BYTES,
      label,
    })
    return toRecord(body)
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error
    return {}
  }
}

/** Maps a failed Fivetran webhook management call to an actionable message. */
function fivetranFailureMessage(action: string, status: number, body: Record<string, unknown>) {
  if (status === 401) {
    return 'Invalid Fivetran API key or secret. Check both values in the trigger configuration.'
  }
  if (status === 403) {
    return 'This Fivetran API key is not allowed to manage webhooks. Use a key with account or group admin permissions.'
  }
  const providerMessage = toStringOrNull(body.message)
  return providerMessage
    ? `Failed to ${action} the Fivetran webhook: ${providerMessage}`
    : `Failed to ${action} the Fivetran webhook (HTTP ${status})`
}

function webhookUrl(externalId: string): string {
  return `${FIVETRAN_WEBHOOKS_URL}/${encodeURIComponent(externalId)}`
}

/**
 * Fivetran signs each delivery with an HMAC-SHA256 hex digest of the raw body, keyed by the
 * secret set when the webhook was created, and sends it in `X-Fivetran-Signature-256`.
 * Fivetran's reference receivers compare the digest case-insensitively.
 */
function isValidFivetranSignature(secret: string, signature: string, rawBody: string): boolean {
  if (!secret || !signature || !rawBody) return false
  return safeCompare(hmacSha256Hex(rawBody, secret), signature.trim().toLowerCase())
}

const SIGNATURE_HEADER = 'x-fivetran-signature-256'
/** Fivetran's documented test deliveries describe this dummy connection. */
const FIVETRAN_TEST_CONNECTION_ID = '_connection_1'

/**
 * Set from webhook creation until activation is recorded. Fivetran tests the URL when the
 * webhook is activated, and that test's shape is undocumented, so during this window an
 * unsigned request or a delivery for Fivetran's test connection is acknowledged without
 * running. Signed events for real connections still run, so none are lost in the gap
 * between Fivetran accepting activation and Sim recording it.
 */
function isAwaitingActivation(providerConfig: Record<string, unknown>): boolean {
  return providerConfig.subscriptionActivationPending === true
}

export const fivetranHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const signature = request.headers.get(SIGNATURE_HEADER)
    if (!signature && isAwaitingActivation(providerConfig)) return null

    const secret = readString(providerConfig, 'webhookSecret')
    if (!secret) {
      logger.warn(`[${requestId}] Fivetran webhook has no signing secret — rejecting request`)
      return new NextResponse(
        'Unauthorized - Fivetran webhook signing secret is missing. Redeploy the workflow to register the webhook.',
        { status: 401 }
      )
    }

    if (!signature) {
      logger.warn(`[${requestId}] Fivetran webhook missing X-Fivetran-Signature-256 header`)
      return new NextResponse('Unauthorized - Missing Fivetran signature', { status: 401 })
    }

    if (!isValidFivetranSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] Fivetran signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Fivetran signature', { status: 401 })
    }

    return null
  },

  async matchEvent({
    webhook,
    body,
    request,
    requestId,
    providerConfig,
  }: EventMatchContext): Promise<boolean> {
    const payload = toRecord(body)
    if (
      isAwaitingActivation(providerConfig) &&
      (!request.headers.get(SIGNATURE_HEADER) ||
        payload.connector_id === FIVETRAN_TEST_CONNECTION_ID)
    ) {
      logger.info(`[${requestId}] Acknowledged Fivetran activation test without running`, {
        webhookId: webhook.id,
      })
      return false
    }

    const event = toStringOrNull(payload.event) ?? ''
    const triggerId = readString(providerConfig, 'triggerId')
    if (triggerId) {
      const { isFivetranEventMatch } = await import('@/triggers/fivetran/utils')
      if (!isFivetranEventMatch(triggerId, event)) {
        logger.debug(
          `[${requestId}] Fivetran event ${event || '(missing)'} does not match trigger ${triggerId}. Skipping execution.`,
          { webhookId: webhook.id, triggerId }
        )
        return false
      }
    }

    // Transformation events describe a dbt job and carry no connection, so the filter skips them.
    const connectionId = readString(providerConfig, 'triggerConnectionId')
    if (
      connectionId &&
      !event.startsWith('transformation_') &&
      payload.connector_id !== connectionId
    ) {
      logger.debug(`[${requestId}] Fivetran event is for another connection. Skipping execution.`, {
        webhookId: webhook.id,
      })
      return false
    }

    return true
  },

  /**
   * Fivetran sends no delivery ID, and events of one type can share a connection, sync, and
   * timestamp (for example two table re-syncs), so the key hashes the whole event. A retry
   * resends the same event, so its key is stable.
   */
  extractIdempotencyId(body: unknown): string | null {
    const event = toStringOrNull(toRecord(body).event)
    return event ? `fivetran:${event}:${buildFallbackDeliveryFingerprint(body)}` : null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = toRecord(body)
    return {
      input: {
        event: payload.event ?? null,
        createdAt: payload.created ?? null,
        connectorType: payload.connector_type ?? null,
        connectorId: payload.connector_id ?? null,
        connectorName: payload.connector_name ?? null,
        syncId: payload.sync_id ?? null,
        destinationGroupId: payload.destination_group_id ?? null,
        data: toRecordOrNull(payload.data),
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const providerConfig = getProviderConfig(ctx.webhook)
    const credentials = readCredentials(providerConfig)
    if (!credentials) {
      throw new Error('A Fivetran API key and secret are required to register the webhook.')
    }

    const triggerId = readString(providerConfig, 'triggerId')
    const { getFivetranWebhookEvents } = await import('@/triggers/fivetran/utils')
    const events = getFivetranWebhookEvents(triggerId)
    if (!events) throw new Error(`Unknown Fivetran trigger: ${triggerId || '(missing)'}`)

    const groupId = readString(providerConfig, 'triggerGroupId')
    const url = groupId
      ? `${FIVETRAN_WEBHOOKS_URL}/group/${encodeURIComponent(groupId)}`
      : `${FIVETRAN_WEBHOOKS_URL}/account`
    const webhookSecret = generateRandomHex(64)

    logger.info(`[${ctx.requestId}] Creating Fivetran ${groupId ? 'group' : 'account'} webhook`, {
      webhookId: ctx.webhook.id,
      triggerId,
    })

    // Created inactive: Fivetran tests the URL on creation and on activation, and only the
    // activation test can be answered, once Sim has stored the signing secret.
    const response = await fivetranRequest(credentials, url, 'POST', {
      url: getNotificationUrl(ctx.webhook),
      events,
      active: false,
      secret: webhookSecret,
    })
    const responseBody = await readFivetranResponse(response, 'Fivetran webhook creation response')
    if (!response.ok) {
      throw new Error(fivetranFailureMessage('register', response.status, responseBody))
    }

    const externalId = toStringOrNull(toRecord(responseBody.data).id)
    if (!externalId) throw new Error('Fivetran created the webhook but did not return its ID.')

    logger.info(`[${ctx.requestId}] Created inactive Fivetran webhook ${externalId}`)
    return {
      providerConfigUpdates: { externalId, webhookSecret, subscriptionActivationPending: true },
    }
  },

  async activateSubscription(ctx: SubscriptionContext): Promise<void> {
    const providerConfig = getProviderConfig(ctx.webhook)
    const credentials = readCredentials(providerConfig)
    const externalId = readString(providerConfig, 'externalId')
    if (!credentials || !externalId) {
      throw new Error('The Fivetran webhook ID and API credentials are required to activate it.')
    }

    const response = await fivetranRequest(credentials, webhookUrl(externalId), 'PATCH', {
      active: true,
    })
    if (!response.ok) {
      const responseBody = await readFivetranResponse(
        response,
        'Fivetran webhook activation response'
      )
      throw new Error(fivetranFailureMessage('activate', response.status, responseBody))
    }
    logger.info(`[${ctx.requestId}] Activated Fivetran webhook ${externalId}`)
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const providerConfig = getProviderConfig(ctx.webhook)
      const credentials = readCredentials(providerConfig)
      const externalId = readString(providerConfig, 'externalId')
      if (!credentials || !externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing ${credentials ? 'externalId' : 'API credentials'} for Fivetran webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict)
          throw new Error('Missing Fivetran API credentials or webhook ID for deletion')
        return
      }

      const response = await fivetranRequest(credentials, webhookUrl(externalId), 'DELETE')
      if (response.ok || response.status === 404) {
        logger.info(`[${ctx.requestId}] Removed Fivetran webhook ${externalId}`)
        return
      }

      const responseBody = await readFivetranResponse(
        response,
        'Fivetran webhook deletion response'
      )
      const message = fivetranFailureMessage('delete', response.status, responseBody)
      logger.warn(`[${ctx.requestId}] ${message} (non-fatal)`)
      if (ctx.strict) throw new Error(message)
    } catch (error) {
      logger.warn(
        `[${ctx.requestId}] Error deleting Fivetran webhook (non-fatal): ${getErrorMessage(error)}`
      )
      if (ctx.strict) throw error
    }
  },
}
