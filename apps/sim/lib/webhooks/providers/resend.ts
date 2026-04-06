import crypto from 'node:crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
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

const logger = createLogger('WebhookProvider:Resend')

const ALL_RESEND_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
  'email.received',
  'email.scheduled',
  'email.suppressed',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'domain.created',
  'domain.updated',
  'domain.deleted',
]

/**
 * Verify a Resend webhook signature using the Svix signing scheme.
 * Resend uses Svix under the hood: HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${body}`
 * signed with the base64-decoded `whsec_...` secret.
 */
function verifySvixSignature(
  secret: string,
  msgId: string,
  timestamp: string,
  signatures: string,
  rawBody: string
): boolean {
  try {
    const ts = Number.parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Number.isNaN(ts) || Math.abs(now - ts) > 5 * 60) {
      return false
    }

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const toSign = `${msgId}.${timestamp}.${rawBody}`
    const expectedSignature = crypto
      .createHmac('sha256', secretBytes)
      .update(toSign, 'utf8')
      .digest('base64')

    const providedSignatures = signatures.split(' ')
    for (const versionedSig of providedSignatures) {
      const parts = versionedSig.split(',')
      if (parts.length !== 2) continue
      const sig = parts[1]
      if (safeCompare(sig, expectedSignature)) {
        return true
      }
    }
    return false
  } catch (error) {
    logger.error('Error verifying Resend Svix signature:', error)
    return false
  }
}

export const resendHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret) {
      return null
    }

    const svixId = request.headers.get('svix-id')
    const svixTimestamp = request.headers.get('svix-timestamp')
    const svixSignature = request.headers.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn(`[${requestId}] Resend webhook missing Svix signature headers`)
      return new NextResponse('Unauthorized - Missing Resend signature headers', { status: 401 })
    }

    if (!verifySvixSignature(signingSecret, svixId, svixTimestamp, svixSignature, rawBody)) {
      logger.warn(`[${requestId}] Resend Svix signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Resend signature', { status: 401 })
    }

    return null
  },

  matchEvent({ body, providerConfig, requestId }: EventMatchContext): boolean {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'resend_webhook') {
      return true
    }

    const EVENT_TYPE_MAP: Record<string, string> = {
      resend_email_sent: 'email.sent',
      resend_email_delivered: 'email.delivered',
      resend_email_bounced: 'email.bounced',
      resend_email_complained: 'email.complained',
      resend_email_opened: 'email.opened',
      resend_email_clicked: 'email.clicked',
      resend_email_failed: 'email.failed',
    }

    const expectedType = EVENT_TYPE_MAP[triggerId]
    const actualType = (body as Record<string, unknown>)?.type as string | undefined

    if (expectedType && actualType !== expectedType) {
      logger.debug(
        `[${requestId}] Resend event type mismatch: expected ${expectedType}, got ${actualType}. Skipping.`
      )
      return false
    }

    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = body as Record<string, unknown>
    const data = payload.data as Record<string, unknown> | undefined
    const bounce = data?.bounce as Record<string, unknown> | undefined
    const click = data?.click as Record<string, unknown> | undefined

    return {
      input: {
        type: payload.type,
        created_at: payload.created_at,
        email_id: data?.email_id ?? null,
        from: data?.from ?? null,
        to: data?.to ?? null,
        subject: data?.subject ?? null,
        bounceType: bounce?.type ?? null,
        bounceSubType: bounce?.subType ?? null,
        bounceMessage: bounce?.message ?? null,
        clickIpAddress: click?.ipAddress ?? null,
        clickLink: click?.link ?? null,
        clickTimestamp: click?.timestamp ?? null,
        clickUserAgent: click?.userAgent ?? null,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined

      if (!apiKey) {
        logger.warn(`[${requestId}] Missing apiKey for Resend webhook creation.`, {
          webhookId: webhook.id,
        })
        throw new Error(
          'Resend API Key is required. Please provide your Resend API Key in the trigger configuration.'
        )
      }

      const eventTypeMap: Record<string, string[]> = {
        resend_email_sent: ['email.sent'],
        resend_email_delivered: ['email.delivered'],
        resend_email_bounced: ['email.bounced'],
        resend_email_complained: ['email.complained'],
        resend_email_opened: ['email.opened'],
        resend_email_clicked: ['email.clicked'],
        resend_email_failed: ['email.failed'],
        resend_webhook: ALL_RESEND_EVENTS,
      }

      const events = eventTypeMap[triggerId ?? ''] ?? ALL_RESEND_EVENTS
      const notificationUrl = getNotificationUrl(webhook)

      logger.info(`[${requestId}] Creating Resend webhook`, {
        triggerId,
        events,
        webhookId: webhook.id,
      })

      const resendResponse = await fetch('https://api.resend.com/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: notificationUrl,
          events,
        }),
      })

      const responseBody = (await resendResponse.json()) as Record<string, unknown>

      if (!resendResponse.ok) {
        const errorMessage =
          (responseBody.message as string) ||
          (responseBody.name as string) ||
          'Unknown Resend API error'
        logger.error(
          `[${requestId}] Failed to create webhook in Resend for webhook ${webhook.id}. Status: ${resendResponse.status}`,
          { message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Resend'
        if (resendResponse.status === 401 || resendResponse.status === 403) {
          userFriendlyMessage = 'Invalid Resend API Key. Please verify your API Key is correct.'
        } else if (errorMessage && errorMessage !== 'Unknown Resend API error') {
          userFriendlyMessage = `Resend error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Resend for webhook ${webhook.id}.`,
        {
          resendWebhookId: responseBody.id,
        }
      )

      return {
        providerConfigUpdates: {
          externalId: responseBody.id,
          signingSecret: responseBody.signing_secret,
        },
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Resend webhook creation for webhook ${webhook.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
      )
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing apiKey or externalId for Resend webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const resendResponse = await fetch(`https://api.resend.com/webhooks/${externalId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!resendResponse.ok && resendResponse.status !== 404) {
        const responseBody = await resendResponse.json().catch(() => ({}))
        logger.warn(
          `[${requestId}] Failed to delete Resend webhook (non-fatal): ${resendResponse.status}`,
          { response: responseBody }
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Resend webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Resend webhook (non-fatal)`, error)
    }
  },
}
