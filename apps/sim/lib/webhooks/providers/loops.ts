import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Base64 } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Loops')

const LOOPS_WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60

/**
 * Verify a Loops webhook signature.
 * Loops uses a Svix-compatible signing scheme (its own implementation, not Svix-hosted):
 * HMAC-SHA256 of `${webhookId}.${timestamp}.${body}` signed with the base64-decoded signing
 * secret (provided as `prefix_base64string`). Delivery metadata arrives in the `Webhook-Id` and
 * `Webhook-Timestamp` headers, and the `Webhook-Signature` header carries one or more
 * space-separated `version,signature` pairs (e.g. `v1,<base64>`).
 * @see https://loops.so/docs/webhooks
 */
function verifyLoopsSignature(
  secret: string,
  webhookId: string,
  timestamp: string,
  signatureHeader: string,
  rawBody: string
): boolean {
  try {
    const ts = Number.parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Number.isNaN(ts) || Math.abs(now - ts) > LOOPS_WEBHOOK_TIMESTAMP_SKEW_SECONDS) {
      return false
    }

    const base64Secret = secret.includes('_') ? secret.slice(secret.indexOf('_') + 1) : secret
    const secretBytes = Buffer.from(base64Secret, 'base64')
    const toSign = `${webhookId}.${timestamp}.${rawBody}`
    const expectedSignature = hmacSha256Base64(toSign, secretBytes)

    const providedSignatures = signatureHeader.split(' ')
    for (const versionedSig of providedSignatures) {
      const parts = versionedSig.split(',')
      const sig = parts.length === 2 ? parts[1] : versionedSig
      if (sig && safeCompare(sig, expectedSignature)) {
        return true
      }
    }
    return false
  } catch (error) {
    logger.error('Error verifying Loops signature:', error)
    return false
  }
}

export const loopsHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn(`[${requestId}] Loops webhook missing signing secret in provider configuration`)
      return new NextResponse('Unauthorized - Loops signing secret is required', { status: 401 })
    }

    const webhookId = request.headers.get('webhook-id')
    const timestamp = request.headers.get('webhook-timestamp')
    const signature = request.headers.get('webhook-signature')

    if (!webhookId || !timestamp || !signature) {
      logger.warn(`[${requestId}] Loops webhook missing signature headers`)
      return new NextResponse('Unauthorized - Missing Loops signature headers', { status: 401 })
    }

    if (!verifyLoopsSignature(signingSecret, webhookId, timestamp, signature, rawBody)) {
      logger.warn(`[${requestId}] Loops signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Loops signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) {
      return true
    }

    const { isLoopsEventMatch } = await import('@/triggers/loops/utils')
    if (!isLoopsEventMatch(triggerId, body as Record<string, unknown>)) {
      const actualEvent = (body as Record<string, unknown>)?.eventName
      logger.debug(
        `[${requestId}] Loops event mismatch for trigger ${triggerId}. Got: ${String(actualEvent)}. Skipping.`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = body as Record<string, unknown>
    const email = payload.email as Record<string, unknown> | undefined
    const contactIdentity = payload.contactIdentity as Record<string, unknown> | undefined

    return {
      input: {
        eventName: payload.eventName ?? null,
        eventTime: payload.eventTime ?? null,
        webhookSchemaVersion: payload.webhookSchemaVersion ?? null,
        sourceType: payload.sourceType ?? null,
        campaignId: payload.campaignId ?? null,
        campaignName: payload.campaignName ?? null,
        loopId: payload.loopId ?? null,
        loopName: payload.loopName ?? null,
        transactionalId: payload.transactionalId ?? null,
        mailingLists: payload.mailingLists ?? null,
        email: email ?? null,
        emailId: email?.id ?? null,
        emailMessageId: email?.emailMessageId ?? null,
        subject: email?.subject ?? null,
        contactIdentity: contactIdentity ?? null,
        contactId: contactIdentity?.id ?? null,
        contactEmail: contactIdentity?.email ?? null,
        userId: contactIdentity?.userId ?? null,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const eventName = obj?.eventName as string | undefined
    const eventTime = obj?.eventTime
    const email = obj?.email as Record<string, unknown> | undefined
    const emailId = email?.id as string | undefined
    if (eventName && emailId && eventTime != null) {
      return `${eventName}:${emailId}:${String(eventTime)}`
    }
    return null
  },
}
