import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
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
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'
import {
  RESEND_ALL_WEBHOOK_EVENT_TYPES,
  RESEND_TRIGGER_TO_EVENT_TYPE,
} from '@/triggers/resend/utils'

const logger = createLogger('WebhookProvider:Resend')

export const resendHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) {
      logger.warn('Resend webhook missing signing secret in provider configuration', { requestId })
      return new NextResponse('Unauthorized - Resend signing secret is required', { status: 401 })
    }

    const failure = verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'Resend',
      headerPrefix: 'svix',
    })
    if (failure) return failure

    return null
  },

  matchEvent({ body, providerConfig, requestId }: EventMatchContext): boolean {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'resend_webhook') {
      return true
    }

    const expectedType = RESEND_TRIGGER_TO_EVENT_TYPE[triggerId]
    if (!expectedType) {
      logger.debug(`Unknown Resend triggerId ${triggerId}, skipping.`, { requestId })
      return false
    }

    const actualType = (body as Record<string, unknown>)?.type as string | undefined

    if (actualType !== expectedType) {
      logger.debug(
        `Resend event type mismatch: expected ${expectedType}, got ${actualType}. Skipping.`,
        { requestId }
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
    const dataCreatedAt = data?.created_at
    const dataCreatedAtStr =
      typeof dataCreatedAt === 'string'
        ? dataCreatedAt
        : dataCreatedAt != null
          ? String(dataCreatedAt)
          : null

    return {
      input: {
        type: payload.type,
        created_at: payload.created_at,
        data_created_at: dataCreatedAtStr,
        data: data ?? null,
        email_id: data?.email_id ?? null,
        broadcast_id: data?.broadcast_id ?? null,
        template_id: data?.template_id ?? null,
        tags: data?.tags ?? null,
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
        logger.warn('Missing apiKey for Resend webhook creation.', {
          requestId,
          webhookId: webhook.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Resend API Key is required. Please provide your Resend API Key in the trigger configuration.'
        )
      }

      const events =
        triggerId === 'resend_webhook'
          ? RESEND_ALL_WEBHOOK_EVENT_TYPES
          : triggerId && RESEND_TRIGGER_TO_EVENT_TYPE[triggerId]
            ? [RESEND_TRIGGER_TO_EVENT_TYPE[triggerId]]
            : null

      if (!events?.length) {
        throw new Error(`Unknown or unsupported Resend trigger type: ${triggerId ?? '(missing)'}`)
      }

      const notificationUrl = getNotificationUrl(webhook)

      logger.info('Creating Resend webhook', {
        requestId,
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
          `Failed to create webhook in Resend for webhook ${webhook.id}. Status: ${resendResponse.status}`,
          { requestId, message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Resend'
        if (resendResponse.status === 401 || resendResponse.status === 403) {
          userFriendlyMessage = 'Invalid Resend API Key. Please verify your API Key is correct.'
        } else if (errorMessage && errorMessage !== 'Unknown Resend API error') {
          userFriendlyMessage = `Resend error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const externalId = responseBody.id
      const signingSecretOut = responseBody.signing_secret

      if (typeof externalId !== 'string' || !externalId.trim()) {
        throw new Error(
          'Resend webhook was created but the API response did not include a webhook id.'
        )
      }
      if (typeof signingSecretOut !== 'string' || !signingSecretOut.trim()) {
        throw new Error(
          'Resend webhook was created but the API response did not include a signing secret.'
        )
      }

      logger.info(`Successfully created webhook in Resend for webhook ${webhook.id}.`, {
        requestId,
        resendWebhookId: externalId,
      })

      return {
        providerConfigUpdates: {
          externalId,
          signingSecret: signingSecretOut,
        },
      }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const err = error as Error
      logger.error(`Exception during Resend webhook creation for webhook ${webhook.id}.`, {
        requestId,
        message: err.message,
        stack: err.stack,
      })
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
          `Missing apiKey or externalId for Resend webhook deletion ${webhook.id}, skipping cleanup`,
          { requestId }
        )
        if (ctx.strict) throw new Error('Missing Resend webhook deletion credentials')
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
        logger.warn(`Failed to delete Resend webhook (non-fatal): ${resendResponse.status}`, {
          requestId,
          response: responseBody,
        })
        if (ctx.strict) throw new Error(`Failed to delete Resend webhook: ${resendResponse.status}`)
      } else {
        logger.info(`Successfully deleted Resend webhook ${externalId}`, { requestId })
      }
    } catch (error) {
      logger.warn('Error deleting Resend webhook (non-fatal)', error, { requestId })
      if (ctx.strict) throw error
    }
  },
}
