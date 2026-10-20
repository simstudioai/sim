import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toNumberOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { projectConversation, projectCustomer } from '@/tools/helpscout/utils'
import { HELPSCOUT_GENERIC_TRIGGER_ID, isHelpScoutEventMatch } from '@/triggers/helpscout/utils'

const logger = createLogger('WebhookProvider:HelpScout')

const EVENT_HEADER = 'x-helpscout-event'
const SIGNATURE_HEADER = 'x-helpscout-signature'

/** Help Scout signs the raw body with HMAC-SHA1 keyed by the webhook secret, base64-encoded. */
function validateHelpScoutSignature(secret: string, signature: string, rawBody: string): boolean {
  if (!secret || !signature || !rawBody) return false
  const computed = createHmac('sha1', secret).update(rawBody, 'utf8').digest('base64')
  return safeCompare(computed, signature.trim())
}

function readEventType(headers: Record<string, string>): string {
  return headers[EVENT_HEADER]?.trim() ?? ''
}

export const helpScoutHandler: WebhookProviderHandler = {
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
