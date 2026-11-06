import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Loops')

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

    // Loops secrets are `<prefix>_<base64>` and the prefix is not always `whsec`;
    // with no `_`, indexOf is -1 and the whole secret is kept.
    const base64Secret = signingSecret.slice(signingSecret.indexOf('_') + 1)

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: base64Secret,
      providerLabel: 'Loops',
    })
    if (failure) return failure

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
