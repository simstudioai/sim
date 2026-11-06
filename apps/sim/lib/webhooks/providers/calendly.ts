import { createLogger } from '@sim/logger'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
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
        logger.warn('Missing apiKey for Calendly webhook creation.', {
          requestId: ctx.requestId,
          webhookId: ctx.webhook.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Personal Access Token is required to create Calendly webhook. Please provide your Calendly Personal Access Token.'
        )
      }

      if (!organization) {
        logger.warn('Missing organization URI for Calendly webhook creation.', {
          requestId: ctx.requestId,
          webhookId: ctx.webhook.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Organization URI is required to create Calendly webhook. Please provide your Organization URI from the "Get Current User" operation.'
        )
      }

      if (!triggerId) {
        logger.warn('Missing triggerId for Calendly webhook creation.', {
          requestId: ctx.requestId,
          webhookId: ctx.webhook.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Trigger ID is required to create Calendly webhook'
        )
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
          `Failed to create webhook in Calendly for webhook ${ctx.webhook.id}. Status: ${calendlyResponse.status}`,
          { requestId: ctx.requestId, response: errorBody }
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
          `Calendly webhook created but no webhook URI returned for webhook ${ctx.webhook.id}`,
          { requestId: ctx.requestId, response: responseBody }
        )
        throw new Error('Calendly webhook creation succeeded but no webhook URI was returned')
      }

      const webhookId = webhookUri.split('/').pop()

      if (!webhookId) {
        logger.error(`Could not extract webhook ID from Calendly URI: ${webhookUri}`, {
          requestId: ctx.requestId,
          response: responseBody,
        })
        throw new Error('Failed to extract webhook ID from Calendly response')
      }

      logger.info(`Successfully created webhook in Calendly for webhook ${ctx.webhook.id}.`, {
        requestId: ctx.requestId,
        calendlyWebhookUri: webhookUri,
        calendlyWebhookId: webhookId,
      })
      return { providerConfigUpdates: { externalId: webhookId } }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const err = error as Error
      logger.error(`Exception during Calendly webhook creation for webhook ${ctx.webhook.id}.`, {
        requestId: ctx.requestId,
        message: err.message,
        stack: err.stack,
      })
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
          `Missing apiKey for Calendly webhook deletion ${ctx.webhook.id}, skipping cleanup`,
          { requestId: ctx.requestId }
        )
        if (ctx.strict) throw new Error('Missing Calendly apiKey for webhook deletion')
        return
      }

      if (!externalId) {
        logger.warn(
          `Missing externalId for Calendly webhook deletion ${ctx.webhook.id}, skipping cleanup`,
          { requestId: ctx.requestId }
        )
        if (ctx.strict) throw new Error('Missing Calendly externalId for webhook deletion')
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
        logger.warn(`Failed to delete Calendly webhook (non-fatal): ${calendlyResponse.status}`, {
          requestId: ctx.requestId,
          response: responseBody,
        })
        if (ctx.strict) {
          throw new Error(`Failed to delete Calendly webhook: ${calendlyResponse.status}`)
        }
      } else {
        logger.info(`Successfully deleted Calendly webhook subscription ${externalId}`, {
          requestId: ctx.requestId,
        })
      }
    } catch (error) {
      logger.warn('Error deleting Calendly webhook (non-fatal)', error, {
        requestId: ctx.requestId,
      })
      if (ctx.strict) throw error
    }
  },
}
