import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:QuickBooks')

export function verifyQuickBooksSignature(
  rawBody: string,
  signature: string | null,
  requestId: string,
  verifierToken: string | undefined = env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
): NextResponse | null {
  if (!verifierToken) {
    logger.warn(`[${requestId}] QuickBooks webhook verifier token is not configured`)
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (!signature) {
    logger.warn(`[${requestId}] QuickBooks webhook is missing intuit-signature`)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const expected = hmacSha256Base64(rawBody, verifierToken)
  if (!safeCompare(expected, signature.trim())) {
    logger.warn(`[${requestId}] QuickBooks webhook signature verification failed`)
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const quickBooksHandler: WebhookProviderHandler = {
  ingressMode: 'provider',
  executionMode: 'queue',

  verifyAuth({ request, rawBody, requestId }: AuthContext) {
    return verifyQuickBooksSignature(rawBody, request.headers.get('intuit-signature'), requestId)
  },

  async matchEvent({ body, providerConfig }: EventMatchContext) {
    const event = asRecord(body)
    const triggerId = typeof providerConfig.triggerId === 'string' ? providerConfig.triggerId : ''
    const eventType = typeof event?.type === 'string' ? event.type : ''
    const { isQuickBooksEventMatch } = await import('@/triggers/quickbooks/utils')
    return isQuickBooksEventMatch(triggerId, eventType, providerConfig.eventTypes)
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const event = asRecord(body) ?? {}
    const eventType = typeof event.type === 'string' ? event.type : ''
    const { parseQuickBooksWebhookType } = await import('@/triggers/quickbooks/utils')
    const parsed = parseQuickBooksWebhookType(eventType)

    return {
      input: {
        eventId: typeof event.id === 'string' ? event.id : '',
        eventType,
        entityType: parsed?.entity ?? '',
        action: parsed?.action ?? '',
        entityId: typeof event.intuitentityid === 'string' ? event.intuitentityid : '',
        realmId: typeof event.intuitaccountid === 'string' ? event.intuitaccountid : '',
        eventTime: typeof event.time === 'string' ? event.time : '',
        specVersion: typeof event.specversion === 'string' ? event.specversion : '',
        source: typeof event.source === 'string' ? event.source : '',
        contentType: typeof event.datacontenttype === 'string' ? event.datacontenttype : null,
        data: event.data ?? null,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const event = asRecord(body)
    return typeof event?.id === 'string' ? event.id : null
  },
}
