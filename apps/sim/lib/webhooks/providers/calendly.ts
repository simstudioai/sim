import { createLogger } from '@sim/logger'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Calendly')

export const calendlyHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        event: b.event,
        created_at: b.created_at,
        created_by: b.created_by,
        payload: b.payload,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const providerConfig = getProviderConfig(ctx.webhook)
      const { apiKey, organization, triggerId } = providerConfig as {
        apiKey?: string
        organization?: string
        triggerId?: string
      }

      if (!apiKey) {
        logger.warn(`[${ctx.requestId}] Missing apiKey for Calendly webhook creation.`, {
          webhookId: ctx.webhook.id,
        })
        throw new Error(
          'Personal Access Token is required to create Calendly webhook. Please provide your Calendly Personal Access Token.'
        )
      }

      if (!organization) {
        logger.warn(`[${ctx.requestId}] Missing organization URI for Calendly webhook creation.`, {
          webhookId: ctx.webhook.id,
        })
        throw new Error(
          'Organization URI is required to create Calendly webhook. Please provide your Organization URI from the "Get Current User" operation.'
        )
      }

      if (!triggerId) {
        logger.warn(`[${ctx.requestId}] Missing triggerId for Calendly webhook creation.`, {
          webhookId: ctx.webhook.id,
        })
        throw new Error('Trigger ID is required to create Calendly webhook')
      }

      const notificationUrl = getNotificationUrl(ctx.webhook)

      const eventTypeMap: Record<string, string[]> = {
        calendly_invitee_created: ['invitee.created'],
        calendly_invitee_canceled: ['invitee.canceled'],
        calendly_routing_form_submitted: ['routing_form_submission.created'],
        calendly_webhook: [
          'invitee.created',
          'invitee.canceled',
          'routing_form_submission.created',
        ],
      }

      const events = eventTypeMap[triggerId] || ['invitee.created']

      const calendlyApiUrl = 'https://api.calendly.com/webhook_subscriptions'

      const requestBody = {
        url: notificationUrl,
        events,
        organization,
        scope: 'organization',
      }

      const calendlyResponse = await fetch(calendlyApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!calendlyResponse.ok) {
        const errorBody = await calendlyResponse.json().catch(() => ({}))
        const errorMessage =
          (errorBody as Record<string, string>).message ||
          (errorBody as Record<string, string>).title ||
          'Unknown Calendly API error'
        logger.error(
          `[${ctx.requestId}] Failed to create webhook in Calendly for webhook ${ctx.webhook.id}. Status: ${calendlyResponse.status}`,
          { response: errorBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Calendly'
        if (calendlyResponse.status === 401) {
          userFriendlyMessage =
            'Calendly authentication failed. Please verify your Personal Access Token is correct.'
        } else if (calendlyResponse.status === 403) {
          userFriendlyMessage =
            'Calendly access denied. Please ensure you have appropriate permissions and a paid Calendly subscription.'
        } else if (calendlyResponse.status === 404) {
          userFriendlyMessage =
            'Calendly organization not found. Please verify the Organization URI is correct.'
        } else if (errorMessage && errorMessage !== 'Unknown Calendly API error') {
          userFriendlyMessage = `Calendly error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const responseBody = (await calendlyResponse.json()) as Record<string, unknown>
      const resource = responseBody.resource as Record<string, unknown> | undefined
      const webhookUri = resource?.uri as string | undefined

      if (!webhookUri) {
        logger.error(
          `[${ctx.requestId}] Calendly webhook created but no webhook URI returned for webhook ${ctx.webhook.id}`,
          { response: responseBody }
        )
        throw new Error('Calendly webhook creation succeeded but no webhook URI was returned')
      }

      const webhookId = webhookUri.split('/').pop()

      if (!webhookId) {
        logger.error(
          `[${ctx.requestId}] Could not extract webhook ID from Calendly URI: ${webhookUri}`,
          {
            response: responseBody,
          }
        )
        throw new Error('Failed to extract webhook ID from Calendly response')
      }

      logger.info(
        `[${ctx.requestId}] Successfully created webhook in Calendly for webhook ${ctx.webhook.id}.`,
        {
          calendlyWebhookUri: webhookUri,
          calendlyWebhookId: webhookId,
        }
      )
      return { providerConfigUpdates: { externalId: webhookId } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${ctx.requestId}] Exception during Calendly webhook creation for webhook ${ctx.webhook.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
      )
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey) {
        logger.warn(
          `[${ctx.requestId}] Missing apiKey for Calendly webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        return
      }

      if (!externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing externalId for Calendly webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        return
      }

      const calendlyApiUrl = `https://api.calendly.com/webhook_subscriptions/${externalId}`

      const calendlyResponse = await fetch(calendlyApiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!calendlyResponse.ok && calendlyResponse.status !== 404) {
        const responseBody = await calendlyResponse.json().catch(() => ({}))
        logger.warn(
          `[${ctx.requestId}] Failed to delete Calendly webhook (non-fatal): ${calendlyResponse.status}`,
          { response: responseBody }
        )
      } else {
        logger.info(
          `[${ctx.requestId}] Successfully deleted Calendly webhook subscription ${externalId}`
        )
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Calendly webhook (non-fatal)`, error)
    }
  },
}
