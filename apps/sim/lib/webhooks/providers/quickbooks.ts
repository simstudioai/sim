import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  buildQuickBooksWebhookRoutingKey,
  getQuickBooksWebhookClientConfigByCredentialId,
} from '@/lib/webhooks/quickbooks-credentials'

const logger = createLogger('WebhookProvider:QuickBooks')

export function verifyQuickBooksSignature(
  rawBody: string,
  signature: string | null,
  verifierToken: string | undefined,
  requestId: string
): NextResponse | null {
  return verifyQuickBooksSignatureAgainstVerifierTokens(
    rawBody,
    signature,
    verifierToken ? [verifierToken] : [],
    requestId
  )
}

function unauthorized(requestId: string, reason: string): NextResponse {
  logger.warn(`[${requestId}] ${reason}`)
  return new NextResponse('Unauthorized', { status: 401 })
}

export function verifyQuickBooksSignatureAgainstVerifierTokens(
  rawBody: string,
  signature: string | null,
  verifierTokens: readonly string[],
  requestId: string
): NextResponse | null {
  const configuredTokens = Array.from(
    new Set(verifierTokens.map((token) => token.trim()).filter(Boolean))
  )
  if (configuredTokens.length === 0) {
    return unauthorized(requestId, 'QuickBooks webhook verifier token is not configured')
  }
  if (!signature) {
    return unauthorized(requestId, 'QuickBooks webhook is missing intuit-signature')
  }

  const receivedSignature = signature.trim()
  let isValid = false
  for (const verifierToken of configuredTokens) {
    const expected = hmacSha256Base64(rawBody, verifierToken)
    isValid = safeCompare(expected, receivedSignature) || isValid
  }
  if (!isValid) {
    return unauthorized(requestId, 'QuickBooks webhook signature verification failed')
  }
  return null
}

/**
 * Verifies the delivery against verifier tokens produced one at a time, stopping at the first
 * match so an app-level webhook does not decrypt every connected account before acknowledging.
 */
export async function verifyQuickBooksSignatureAgainstVerifierTokenStream(
  rawBody: string,
  signature: string | null,
  verifierTokens: AsyncIterable<string>,
  requestId: string
): Promise<NextResponse | null> {
  if (!signature) {
    return unauthorized(requestId, 'QuickBooks webhook is missing intuit-signature')
  }

  const receivedSignature = signature.trim()
  let sawConfiguredToken = false
  for await (const verifierToken of verifierTokens) {
    const trimmedToken = verifierToken.trim()
    if (!trimmedToken) continue
    sawConfiguredToken = true
    if (safeCompare(hmacSha256Base64(rawBody, trimmedToken), receivedSignature)) return null
  }
  if (!sawConfiguredToken) {
    return unauthorized(requestId, 'QuickBooks webhook verifier token is not configured')
  }
  return unauthorized(requestId, 'QuickBooks webhook signature verification failed')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const quickBooksHandler: WebhookProviderHandler = {
  ingressMode: 'provider',
  executionMode: 'queue',

  async prepareDeploymentConfig({ credentialId }) {
    if (!credentialId) {
      throw new WebhookDeploymentConfigurationError('Select a QuickBooks account for the trigger.')
    }

    const credentialContext = await getQuickBooksWebhookClientConfigByCredentialId(credentialId)
    if (!credentialContext) {
      throw new WebhookDeploymentConfigurationError(
        'Could not verify the connected QuickBooks company. Reconnect it and try again.'
      )
    }
    if (!credentialContext.clientConfig.webhookVerifierToken) {
      throw new WebhookDeploymentConfigurationError(
        'This QuickBooks connection has no webhook verifier token. Reconnect it with the token from the Intuit app Webhooks settings.'
      )
    }

    return {
      providerConfigUpdates: {
        quickBooksWebhookAppKey: credentialContext.identity.appKey,
      },
      triggerPath: null,
      routingKey: buildQuickBooksWebhookRoutingKey(
        credentialContext.identity.appKey,
        credentialContext.identity.realmId
      ),
    }
  },

  async verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const credentialId =
      typeof providerConfig.credentialId === 'string' ? providerConfig.credentialId : ''
    const credentialContext = credentialId
      ? await getQuickBooksWebhookClientConfigByCredentialId(credentialId)
      : null
    return verifyQuickBooksSignature(
      rawBody,
      request.headers.get('intuit-signature'),
      credentialContext?.clientConfig.webhookVerifierToken,
      requestId
    )
  },

  async matchEvent({ body, providerConfig }: EventMatchContext) {
    const event = asRecord(body)
    const triggerId = typeof providerConfig.triggerId === 'string' ? providerConfig.triggerId : ''
    const eventType = typeof event?.type === 'string' ? event.type : ''
    const { isQuickBooksEventMatch, quickBooksEventTypesSubBlockId } = await import(
      '@/triggers/quickbooks/quickbooks'
    )
    return isQuickBooksEventMatch(
      triggerId,
      eventType,
      providerConfig[quickBooksEventTypesSubBlockId(triggerId)]
    )
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const event = asRecord(body) ?? {}
    const eventType = typeof event.type === 'string' ? event.type : ''
    const { getQuickBooksTriggerDefinitionByEntity, parseQuickBooksWebhookType } = await import(
      '@/triggers/quickbooks/quickbooks'
    )
    const parsed = parseQuickBooksWebhookType(eventType)
    const definition = parsed ? getQuickBooksTriggerDefinitionByEntity(parsed.entity) : undefined

    return {
      input: {
        eventId: typeof event.id === 'string' ? event.id : '',
        eventType,
        entityType: definition?.entityType ?? '',
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
