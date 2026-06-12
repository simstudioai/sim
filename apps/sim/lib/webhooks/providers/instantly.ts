import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { NextResponse } from 'next/server'
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
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'
import { instantlyUrl } from '@/tools/instantly/utils'

const logger = createLogger('WebhookProvider:Instantly')
const SIM_WEBHOOK_TOKEN_HEADER = 'x-sim-webhook-token'

export const instantlyHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secretToken = providerConfig.secretToken as string | undefined
    if (!secretToken) {
      logger.warn(`[${requestId}] Instantly webhook secret token is missing`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    if (!verifyTokenAuth(request, secretToken, SIM_WEBHOOK_TOKEN_HEADER)) {
      logger.warn(`[${requestId}] Unauthorized Instantly webhook request`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, providerConfig, requestId }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    if (!isRecord(body)) {
      logger.warn(`[${requestId}] Instantly webhook payload was not an object`)
      return false
    }

    const { isInstantlyEventMatch } = await import('@/triggers/instantly/utils')
    if (!isInstantlyEventMatch(triggerId, body)) {
      logger.info(`[${requestId}] Instantly event did not match trigger`, {
        triggerId,
        eventType: body.event_type,
      })
      return false
    }

    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = isRecord(body) ? body : {}

    return {
      input: {
        timestamp: toStringOrNull(payload.timestamp),
        eventType: toStringOrNull(payload.event_type),
        workspace: toStringOrNull(payload.workspace),
        campaignId: toStringOrNull(payload.campaign_id),
        campaignName: toStringOrNull(payload.campaign_name),
        leadEmail: toStringOrNull(payload.lead_email),
        emailAccount: toStringOrNull(payload.email_account),
        uniboxUrl: toStringOrNull(payload.unibox_url),
        step: toNumberOrNull(payload.step),
        variant: toNumberOrNull(payload.variant),
        isFirst: toBooleanOrNull(payload.is_first),
        emailId: toStringOrNull(payload.email_id),
        emailSubject: toStringOrNull(payload.email_subject),
        emailText: toStringOrNull(payload.email_text),
        emailHtml: toStringOrNull(payload.email_html),
        replyTextSnippet: toStringOrNull(payload.reply_text_snippet),
        replySubject: toStringOrNull(payload.reply_subject),
        replyText: toStringOrNull(payload.reply_text),
        replyHtml: toStringOrNull(payload.reply_html),
        payload,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    const providerConfig = getProviderConfig(webhook)
    const apiKey = providerConfig.triggerApiKey as string | undefined
    const triggerId = providerConfig.triggerId as string | undefined
    const campaignId = optionalId(providerConfig.triggerCampaignId)

    if (!apiKey?.trim()) {
      throw new Error('Instantly API Key is required.')
    }

    if (!triggerId) {
      throw new Error('Instantly trigger ID is required.')
    }

    const { getInstantlySubscriptionEventTypeForTrigger } = await import(
      '@/triggers/instantly/utils'
    )
    const eventType = getInstantlySubscriptionEventTypeForTrigger(triggerId)
    if (!eventType) {
      throw new Error(`Unknown Instantly trigger type: ${triggerId}`)
    }

    const secretToken =
      typeof providerConfig.secretToken === 'string' && providerConfig.secretToken.length > 0
        ? providerConfig.secretToken
        : generateShortId(32)

    const requestBody: Record<string, unknown> = {
      name: `Sim - ${triggerId.replace(/^instantly_/, '').replace(/_/g, ' ')}`,
      target_hook_url: getNotificationUrl(webhook),
      event_type: eventType,
      headers: {
        'X-Sim-Webhook-Token': secretToken,
      },
    }

    if (campaignId) {
      requestBody.campaign = campaignId
    }

    logger.info(`[${requestId}] Creating Instantly webhook`, {
      triggerId,
      eventType,
      hasCampaignId: Boolean(campaignId),
      webhookId: webhook.id,
    })

    const response = await fetch(instantlyUrl('/api/v2/webhooks'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await parseJsonResponse(response)
    if (!response.ok) {
      const message = extractInstantlyError(responseBody)
      logger.error(`[${requestId}] Failed to create Instantly webhook`, {
        status: response.status,
        message,
        response: responseBody,
      })

      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid Instantly API Key or missing webhook permissions.')
      }

      if (response.status === 402) {
        throw new Error('Instantly webhook creation requires an active paid plan.')
      }

      throw new Error(
        message ? `Instantly error: ${message}` : 'Failed to create Instantly webhook'
      )
    }

    const externalId = responseBody?.id
    if (typeof externalId !== 'string' || externalId.length === 0) {
      throw new Error('Instantly webhook was created but the API response did not include an ID.')
    }

    logger.info(`[${requestId}] Successfully created Instantly webhook`, {
      externalId,
      webhookId: webhook.id,
    })

    return { providerConfigUpdates: { externalId, secretToken } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx

    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.triggerApiKey as string | undefined
      const externalId = providerConfig.externalId as string | undefined

      if (!apiKey?.trim() || !externalId?.trim()) {
        logger.warn(`[${requestId}] Missing Instantly webhook cleanup configuration`, {
          webhookId: webhook.id,
          hasApiKey: Boolean(apiKey),
          hasExternalId: Boolean(externalId),
        })
        if (ctx.strict) throw new Error('Missing Instantly webhook cleanup configuration')
        return
      }

      const response = await fetch(
        instantlyUrl(`/api/v2/webhooks/${encodeURIComponent(externalId.trim())}`),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        }
      )

      if (!response.ok && response.status !== 404) {
        const responseBody = await parseJsonResponse(response)
        logger.warn(`[${requestId}] Failed to delete Instantly webhook`, {
          status: response.status,
          response: responseBody,
        })
        if (ctx.strict) throw new Error(`Failed to delete Instantly webhook: ${response.status}`)
        return
      }

      await response.body?.cancel()
      logger.info(`[${requestId}] Successfully deleted Instantly webhook`, {
        externalId,
        webhookId: webhook.id,
      })
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Instantly webhook`, {
        message: toError(error).message,
      })
      if (ctx.strict) throw error
    }
  },
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

function extractInstantlyError(body: Record<string, unknown> | null): string | null {
  if (!body) return null
  if (typeof body.message === 'string') return body.message
  if (typeof body.error === 'string') return body.error
  return null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function optionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '-') return undefined
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
