import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { generateRandomHex } from '@sim/utils/random'
import {
  getCredentialAccessToken,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
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
import { HELPSCOUT_API_BASE, projectConversation, projectCustomer } from '@/tools/helpscout/utils'
import {
  getHelpScoutSubscriptionEvents,
  HELPSCOUT_GENERIC_TRIGGER_ID,
  isHelpScoutEventMatch,
} from '@/triggers/helpscout/utils'

const logger = createLogger('WebhookProvider:HelpScout')

const EVENT_HEADER = 'x-helpscout-event'
const SIGNATURE_HEADER = 'x-helpscout-signature'

/** Help Scout signs the raw body with HMAC-SHA1 keyed by the webhook secret, base64-encoded. */
function validateHelpScoutSignature(secret: string, signature: string, rawBody: string): boolean {
  if (!secret || !signature || !rawBody) return false
  const computed = createHmac('sha1', secret).update(rawBody, 'utf8').digest('base64')
  return safeCompare(computed, signature.trim())
}

const HELPSCOUT_ID_PATTERN = /^\d{1,16}$/
/** Help Scout accepts a signing secret of at most 40 characters. */
const WEBHOOK_SECRET_LENGTH = 40

function readEventType(headers: Record<string, string>): string {
  return headers[EVENT_HEADER]?.trim() ?? ''
}

/**
 * The inbox filter is a canonical selector/manual pair. Deploy collapses it to `triggerMailboxId`;
 * an inbox is optional, so an absent or blank value means every inbox.
 */
function resolveInboxFilter(config: Record<string, unknown>): number | undefined {
  const raw = toStringOrNull(config.triggerMailboxId)?.trim()
  if (!raw) return undefined
  if (!HELPSCOUT_ID_PATTERN.test(raw)) {
    throw new WebhookDeploymentConfigurationError('The Help Scout inbox ID must be numeric.')
  }
  return Number(raw)
}

async function requireAccessToken(config: Record<string, unknown>, requestId: string) {
  const credentialId = toStringOrNull(config.credentialId)
  const accessToken = credentialId ? await getCredentialAccessToken(credentialId, requestId) : null
  if (!accessToken) {
    throw new WebhookDeploymentConfigurationError(
      'Help Scout account connection required. Connect Help Scout in the trigger configuration and deploy again.'
    )
  }
  return accessToken
}

export const helpScoutHandler: WebhookProviderHandler = {
  async createSubscription({
    webhook,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(webhook)
    const triggerId = toStringOrNull(config.triggerId) ?? ''
    const events = getHelpScoutSubscriptionEvents(triggerId)
    if (events.length === 0) {
      throw new WebhookDeploymentConfigurationError(`Unknown Help Scout trigger: ${triggerId}`)
    }
    const mailboxId = resolveInboxFilter(config)
    const accessToken = await requireAccessToken(config, requestId)
    const webhookSecret = generateRandomHex(WEBHOOK_SECRET_LENGTH)

    const response = await fetch(`${HELPSCOUT_API_BASE}/webhooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: getNotificationUrl(webhook),
        events,
        secret: webhookSecret,
        label: 'Sim workflow trigger',
        ...(mailboxId !== undefined ? { mailboxIds: [mailboxId] } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel().catch(() => {})
    if (!response.ok) {
      logger.warn(`[${requestId}] Help Scout webhook creation failed`, { status: response.status })
      const message = `Help Scout webhook creation failed (HTTP ${response.status})`
      if (response.status === 429 || response.status >= 500) throw new Error(message)
      throw new WebhookDeploymentConfigurationError(
        response.status === 401 || response.status === 403
          ? `${message}. Reconnect Help Scout with a user that can manage webhooks.`
          : message
      )
    }

    const externalId = toStringOrNull(response.headers.get('resource-id'))?.trim()
    if (!externalId || !HELPSCOUT_ID_PATTERN.test(externalId)) {
      throw new WebhookDeploymentConfigurationError(
        'Help Scout created the webhook but returned no webhook ID'
      )
    }
    logger.info(`[${requestId}] Created Help Scout webhook`, { externalId, events: events.length })
    return { providerConfigUpdates: { externalId, webhookSecret } }
  },

  async deleteSubscription({
    webhook,
    requestId,
    strict,
  }: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(webhook)
    const externalId = toStringOrNull(config.externalId)?.trim()
    if (!externalId || !HELPSCOUT_ID_PATTERN.test(externalId)) {
      if (strict) throw new Error('Missing Help Scout webhook ID for deletion')
      return
    }
    const credentialId = toStringOrNull(config.credentialId)
    const accessToken = credentialId
      ? await getCredentialAccessToken(credentialId, requestId)
      : null
    if (!accessToken) {
      if (strict) throw new Error('Missing Help Scout token for webhook deletion')
      return
    }
    const response = await fetch(`${HELPSCOUT_API_BASE}/webhooks/${externalId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel().catch(() => {})
    if (!response.ok && response.status !== 404) {
      logger.warn(`[${requestId}] Help Scout webhook deletion failed`, { status: response.status })
      if (strict) throw new Error(`Help Scout webhook deletion failed: ${response.status}`)
    }
  },

  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: SIGNATURE_HEADER,
    validateFn: validateHelpScoutSignature,
    providerLabel: 'Help Scout',
    requireSecret: true,
  }),

  /**
   * Help Scout sends no delivery ID, but a retry resends the identical signed body, so the
   * event name plus the body signature identifies a delivery. The processor strips untrusted
   * Sim idempotency headers before this hook runs.
   */
  enrichHeaders(_ctx, headers) {
    const signature = headers[SIGNATURE_HEADER]?.trim()
    const eventType = readEventType(headers)
    if (signature && eventType) {
      headers['x-sim-idempotency-key'] = `helpscout:${eventType}:${signature}`
    }
  },

  matchEvent({ request, requestId, providerConfig }: EventMatchContext) {
    const triggerId = typeof providerConfig.triggerId === 'string' ? providerConfig.triggerId : ''
    if (!triggerId || triggerId === HELPSCOUT_GENERIC_TRIGGER_ID) return true

    const eventType = request.headers.get(EVENT_HEADER)?.trim() ?? ''
    if (isHelpScoutEventMatch(triggerId, eventType)) return true

    logger.debug(`[${requestId}] Help Scout event ${eventType} does not match ${triggerId}`)
    return false
  },

  async formatInput({ body, headers, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const eventType = readEventType(headers)
    const payload = toRecord(body)
    const triggerId = toRecord(webhook.providerConfig).triggerId

    if (triggerId === HELPSCOUT_GENERIC_TRIGGER_ID) {
      return { input: { eventType, payload } }
    }
    if (eventType === 'convo.deleted') {
      return { input: { eventType, conversationId: toNumberOrNull(payload.id), payload } }
    }
    if (eventType.startsWith('convo.')) {
      const conversation = projectConversation(payload)
      return { input: { eventType, conversationId: conversation.id, conversation, payload } }
    }
    if (eventType === 'customer.created' || eventType === 'customer.updated') {
      const customer = projectCustomer(payload)
      return { input: { eventType, customerId: customer.id, customer, payload } }
    }
    return { input: { eventType, payload } }
  },
}
