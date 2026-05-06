import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { emailBisonHeaders, emailBisonUrl } from '@/tools/emailbison/utils'

const logger = createLogger('WebhookProvider:EmailBison')

export const emailBisonHandler: WebhookProviderHandler = {
  async matchEvent({ body, providerConfig, requestId }: EventMatchContext): Promise<boolean> {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    if (!isRecord(body)) {
      logger.warn(`[${requestId}] Email Bison webhook payload was not an object`)
      return false
    }

    const { isEmailBisonEventMatch } = await import('@/triggers/emailbison/utils')
    if (!isEmailBisonEventMatch(triggerId, unwrapEmailBisonPayload(body))) {
      logger.info(`[${requestId}] Email Bison event did not match trigger`, {
        triggerId,
      })
      return false
    }

    return true
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const payload = isRecord(body) ? unwrapEmailBisonPayload(body) : {}
    const event = isRecord(payload.event) ? payload.event : null
    const data = isRecord(payload.data) ? payload.data : null
    const providerConfig = getProviderConfig(webhook)
    const triggerId = providerConfig.triggerId as string | undefined
    const input: Record<string, unknown> = {
      eventType: toStringOrNull(event?.type),
      eventName: toStringOrNull(event?.name),
      instanceUrl: toStringOrNull(event?.instance_url),
      workspaceId: toNumberOrNull(event?.workspace_id),
      workspaceName: toStringOrNull(event?.workspace_name),
      event,
      data,
    }

    if (
      triggerId === 'emailbison_email_sent' ||
      triggerId === 'emailbison_lead_first_contacted' ||
      triggerId === 'emailbison_lead_unsubscribed' ||
      triggerId === 'emailbison_email_opened'
    ) {
      input.scheduledEmail = toRecordOrNull(data?.scheduled_email)
      input.campaignEvent = renameTypeField(data?.campaign_event, 'event_type')
      input.lead = toRecordOrNull(data?.lead)
      input.campaign = toRecordOrNull(data?.campaign)
      input.senderEmail = renameTypeField(data?.sender_email, 'account_type')
    }

    if (
      triggerId === 'emailbison_lead_replied' ||
      triggerId === 'emailbison_lead_interested' ||
      triggerId === 'emailbison_email_bounced'
    ) {
      input.reply = renameTypeField(data?.reply, 'reply_type')
      input.campaignEvent = renameTypeField(data?.campaign_event, 'event_type')
      input.lead = toRecordOrNull(data?.lead)
      input.campaign = toRecordOrNull(data?.campaign)
      input.scheduledEmail = toRecordOrNull(data?.scheduled_email)
      input.senderEmail = renameTypeField(data?.sender_email, 'account_type')
    }

    if (triggerId === 'emailbison_untracked_reply_received') {
      input.reply = renameTypeField(data?.reply, 'reply_type')
      input.senderEmail = renameTypeField(data?.sender_email, 'account_type')
    }

    if (
      triggerId === 'emailbison_email_account_added' ||
      triggerId === 'emailbison_email_account_removed' ||
      triggerId === 'emailbison_email_account_disconnected' ||
      triggerId === 'emailbison_email_account_reconnected' ||
      triggerId === 'emailbison_warmup_disabled_receiving_bounces' ||
      triggerId === 'emailbison_warmup_disabled_causing_bounces'
    ) {
      input.senderEmail = renameTypeField(data?.sender_email, 'account_type')
    }

    if (triggerId === 'emailbison_manual_email_sent') {
      input.reply = renameTypeField(data?.reply, 'reply_type')
      input.lead = toRecordOrNull(data?.lead)
      input.campaign = toRecordOrNull(data?.campaign)
      input.scheduledEmail = toRecordOrNull(data?.scheduled_email)
      input.senderEmail = renameTypeField(data?.sender_email, 'account_type')
    }

    if (triggerId === 'emailbison_tag_attached' || triggerId === 'emailbison_tag_removed') {
      input.tagId = toNumberOrNull(data?.tag_id)
      input.tagName = toStringOrNull(data?.tag_name)
      input.taggableId = toNumberOrNull(data?.taggable_id)
      input.taggableType = toStringOrNull(data?.taggable_type)
    }

    return {
      input,
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    const providerConfig = getProviderConfig(webhook)
    const apiKey = providerConfig.apiKey as string | undefined
    const apiBaseUrl = providerConfig.apiBaseUrl as string | undefined
    const triggerId = providerConfig.triggerId as string | undefined

    if (!apiKey?.trim()) {
      throw new Error('Email Bison API Key is required.')
    }

    if (!apiBaseUrl?.trim()) {
      throw new Error('Email Bison Instance URL is required.')
    }

    if (!triggerId) {
      throw new Error('Email Bison trigger ID is required.')
    }

    const { getEmailBisonEventTypeForTrigger } = await import('@/triggers/emailbison/utils')
    const eventType = getEmailBisonEventTypeForTrigger(triggerId)
    if (!eventType) {
      throw new Error(`Unknown Email Bison trigger type: ${triggerId}`)
    }

    const notificationUrl = getNotificationUrl(webhook)

    logger.info(`[${requestId}] Creating Email Bison webhook`, {
      triggerId,
      eventType,
      webhookId: webhook.id,
    })

    const response = await fetch(emailBisonUrl('/api/webhook-url', {}, apiBaseUrl), {
      method: 'POST',
      headers: emailBisonHeaders({ apiKey, apiBaseUrl }),
      body: JSON.stringify({
        name: `Sim - ${eventType}`,
        url: notificationUrl,
        events: [eventType],
      }),
    })

    const responseBody = await parseJsonResponse(response)
    if (!response.ok) {
      const message = extractEmailBisonError(responseBody)
      logger.error(`[${requestId}] Failed to create Email Bison webhook`, {
        status: response.status,
        message,
        response: responseBody,
      })

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Invalid Email Bison API Key or Instance URL. Confirm both came from the same Email Bison instance.'
        )
      }

      throw new Error(
        message ? `Email Bison error: ${message}` : 'Failed to create Email Bison webhook'
      )
    }

    const data = isRecord(responseBody?.data) ? responseBody.data : null
    const externalId = data?.id
    if (externalId === undefined || externalId === null || externalId === '') {
      throw new Error('Email Bison webhook was created but the API response did not include an ID.')
    }

    logger.info(`[${requestId}] Successfully created Email Bison webhook`, {
      externalId,
      webhookId: webhook.id,
    })

    return { providerConfigUpdates: { externalId: String(externalId) } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx

    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const apiBaseUrl = providerConfig.apiBaseUrl as string | undefined
      const externalId = providerConfig.externalId as string | undefined

      if (!apiKey?.trim() || !apiBaseUrl?.trim() || !externalId?.trim()) {
        logger.warn(`[${requestId}] Missing Email Bison webhook cleanup configuration`, {
          webhookId: webhook.id,
          hasApiKey: Boolean(apiKey),
          hasApiBaseUrl: Boolean(apiBaseUrl),
          hasExternalId: Boolean(externalId),
        })
        return
      }

      const response = await fetch(
        emailBisonUrl(`/api/webhook-url/${encodeURIComponent(externalId)}`, {}, apiBaseUrl),
        {
          method: 'DELETE',
          headers: emailBisonHeaders({ apiKey, apiBaseUrl }),
        }
      )

      if (!response.ok && response.status !== 404) {
        const responseBody = await parseJsonResponse(response)
        logger.warn(`[${requestId}] Failed to delete Email Bison webhook`, {
          status: response.status,
          response: responseBody,
        })
        return
      }

      await response.body?.cancel()
      logger.info(`[${requestId}] Successfully deleted Email Bison webhook`, {
        externalId,
        webhookId: webhook.id,
      })
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Email Bison webhook`, {
        message: toError(error).message,
      })
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

function extractEmailBisonError(body: Record<string, unknown> | null): string | null {
  if (!body) return null
  if (typeof body.message === 'string') return body.message
  if (typeof body.error === 'string') return body.error

  const data = body.data
  if (isRecord(data) && typeof data.message === 'string') return data.message

  return null
}

function unwrapEmailBisonPayload(body: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(body.event)) return body

  const data = body.data
  if (isRecord(data) && isRecord(data.event)) return data

  const payload = isRecord(data) ? data.payload : body.payload
  if (isRecord(payload) && isRecord(payload.event)) return payload

  return body
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return String(value)
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function renameTypeField(value: unknown, targetKey: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null

  const { type, ...rest } = value
  return { ...rest, [targetKey]: type ?? null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
