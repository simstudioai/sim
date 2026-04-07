import { createLogger } from '@sim/logger'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Lemlist')

export const lemlistHandler: WebhookProviderHandler = {
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const campaignId = providerConfig.campaignId as string | undefined

      if (!apiKey) {
        logger.warn(`[${requestId}] Missing apiKey for Lemlist webhook creation.`, {
          webhookId: webhook.id,
        })
        throw new Error(
          'Lemlist API Key is required. Please provide your Lemlist API Key in the trigger configuration.'
        )
      }

      const eventTypeMap: Record<string, string | undefined> = {
        lemlist_email_replied: 'emailsReplied',
        lemlist_linkedin_replied: 'linkedinReplied',
        lemlist_interested: 'interested',
        lemlist_not_interested: 'notInterested',
        lemlist_email_opened: 'emailsOpened',
        lemlist_email_clicked: 'emailsClicked',
        lemlist_email_bounced: 'emailsBounced',
        lemlist_email_sent: 'emailsSent',
        lemlist_webhook: undefined,
      }

      const eventType = eventTypeMap[triggerId ?? '']
      const notificationUrl = getNotificationUrl(webhook)
      const authString = Buffer.from(`:${apiKey}`).toString('base64')

      logger.info(`[${requestId}] Creating Lemlist webhook`, {
        triggerId,
        eventType,
        hasCampaignId: !!campaignId,
        webhookId: webhook.id,
      })

      const lemlistApiUrl = 'https://api.lemlist.com/api/hooks'

      const requestBody: Record<string, unknown> = {
        targetUrl: notificationUrl,
      }

      if (eventType) {
        requestBody.type = eventType
      }

      if (campaignId) {
        requestBody.campaignId = campaignId
      }

      const lemlistResponse = await fetch(lemlistApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await lemlistResponse.json()) as Record<string, unknown>

      if (!lemlistResponse.ok || responseBody.error) {
        const errorMessage =
          (responseBody.message as string) ||
          (responseBody.error as string) ||
          'Unknown Lemlist API error'
        logger.error(
          `[${requestId}] Failed to create webhook in Lemlist for webhook ${webhook.id}. Status: ${lemlistResponse.status}`,
          { message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Lemlist'
        if (lemlistResponse.status === 401) {
          userFriendlyMessage = 'Invalid Lemlist API Key. Please verify your API Key is correct.'
        } else if (lemlistResponse.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure your Lemlist API Key has appropriate permissions.'
        } else if (errorMessage && errorMessage !== 'Unknown Lemlist API error') {
          userFriendlyMessage = `Lemlist error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Lemlist for webhook ${webhook.id}.`,
        {
          lemlistWebhookId: responseBody._id,
        }
      )

      return { providerConfigUpdates: { externalId: responseBody._id } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Lemlist webhook creation for webhook ${webhook.id}.`,
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

      if (!apiKey) {
        logger.warn(
          `[${requestId}] Missing apiKey for Lemlist webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const authString = Buffer.from(`:${apiKey}`).toString('base64')

      const deleteById = async (id: string) => {
        const validation = validateAlphanumericId(id, 'Lemlist hook ID', 50)
        if (!validation.isValid) {
          logger.warn(`[${requestId}] Invalid Lemlist hook ID format, skipping deletion`, {
            id: id.substring(0, 30),
          })
          return
        }

        const lemlistApiUrl = `https://api.lemlist.com/api/hooks/${id}`
        const lemlistResponse = await fetch(lemlistApiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${authString}`,
          },
        })

        if (!lemlistResponse.ok && lemlistResponse.status !== 404) {
          const responseBody = await lemlistResponse.json().catch(() => ({}))
          logger.warn(
            `[${requestId}] Failed to delete Lemlist webhook (non-fatal): ${lemlistResponse.status}`,
            { response: responseBody }
          )
        } else {
          logger.info(`[${requestId}] Successfully deleted Lemlist webhook ${id}`)
        }
      }

      if (externalId) {
        await deleteById(externalId)
        return
      }

      const notificationUrl = getNotificationUrl(webhook)
      const listResponse = await fetch('https://api.lemlist.com/api/hooks', {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authString}`,
        },
      })

      if (!listResponse.ok) {
        logger.warn(`[${requestId}] Failed to list Lemlist webhooks for cleanup ${webhook.id}`, {
          status: listResponse.status,
        })
        return
      }

      const listBody = (await listResponse.json().catch(() => null)) as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | null
      const hooks: Array<Record<string, unknown>> = Array.isArray(listBody)
        ? listBody
        : ((listBody as Record<string, unknown>)?.hooks as Array<Record<string, unknown>>) ||
          ((listBody as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ||
          []
      const matches = hooks.filter((hook) => {
        const targetUrl = hook?.targetUrl || hook?.target_url || hook?.url
        return typeof targetUrl === 'string' && targetUrl === notificationUrl
      })

      if (matches.length === 0) {
        logger.info(`[${requestId}] Lemlist webhook not found for cleanup ${webhook.id}`, {
          notificationUrl,
        })
        return
      }

      for (const hook of matches) {
        const hookId = (hook?._id || hook?.id) as string | undefined
        if (typeof hookId === 'string' && hookId.length > 0) {
          await deleteById(hookId)
        }
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Lemlist webhook (non-fatal)`, error)
    }
  },
}
