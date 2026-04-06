import { createLogger } from '@sim/logger'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Fathom')

export const fathomHandler: WebhookProviderHandler = {
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const triggeredFor = providerConfig.triggeredFor as string | undefined
      const includeSummary = providerConfig.includeSummary as unknown
      const includeTranscript = providerConfig.includeTranscript as unknown
      const includeActionItems = providerConfig.includeActionItems as unknown
      const includeCrmMatches = providerConfig.includeCrmMatches as unknown

      if (!apiKey) {
        logger.warn(`[${requestId}] Missing apiKey for Fathom webhook creation.`, {
          webhookId: webhook.id,
        })
        throw new Error(
          'Fathom API Key is required. Please provide your API key in the trigger configuration.'
        )
      }

      const notificationUrl = getNotificationUrl(webhook)

      const triggeredForValue = triggeredFor || 'my_recordings'

      const toBool = (val: unknown, fallback: boolean): boolean => {
        if (val === undefined) return fallback
        return val === true || val === 'true'
      }

      const requestBody: Record<string, unknown> = {
        destination_url: notificationUrl,
        triggered_for: [triggeredForValue],
        include_summary: toBool(includeSummary, true),
        include_transcript: toBool(includeTranscript, false),
        include_action_items: toBool(includeActionItems, false),
        include_crm_matches: toBool(includeCrmMatches, false),
      }

      logger.info(`[${requestId}] Creating Fathom webhook`, {
        triggerId,
        triggeredFor: triggeredForValue,
        webhookId: webhook.id,
      })

      const fathomResponse = await fetch('https://api.fathom.ai/external/v1/webhooks', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await fathomResponse.json().catch(() => ({}))) as Record<
        string,
        unknown
      >

      if (!fathomResponse.ok) {
        const errorMessage =
          (responseBody.message as string) ||
          (responseBody.error as string) ||
          'Unknown Fathom API error'
        logger.error(
          `[${requestId}] Failed to create webhook in Fathom for webhook ${webhook.id}. Status: ${fathomResponse.status}`,
          { message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Fathom'
        if (fathomResponse.status === 401) {
          userFriendlyMessage = 'Invalid Fathom API Key. Please verify your key is correct.'
        } else if (fathomResponse.status === 400) {
          userFriendlyMessage = `Fathom error: ${errorMessage}`
        } else if (errorMessage && errorMessage !== 'Unknown Fathom API error') {
          userFriendlyMessage = `Fathom error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      if (!responseBody.id) {
        logger.error(
          `[${requestId}] Fathom webhook creation returned success but no webhook ID for ${webhook.id}.`
        )
        throw new Error('Fathom webhook created but no ID returned. Please try again.')
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Fathom for webhook ${webhook.id}.`,
        {
          fathomWebhookId: responseBody.id,
        }
      )

      return { providerConfigUpdates: { externalId: responseBody.id } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Fathom webhook creation for webhook ${webhook.id}.`,
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
          `[${requestId}] Missing apiKey for Fathom webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      if (!externalId) {
        logger.warn(
          `[${requestId}] Missing externalId for Fathom webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const idValidation = validateAlphanumericId(externalId, 'Fathom webhook ID', 100)
      if (!idValidation.isValid) {
        logger.warn(
          `[${requestId}] Invalid externalId format for Fathom webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const fathomApiUrl = `https://api.fathom.ai/external/v1/webhooks/${externalId}`

      const fathomResponse = await fetch(fathomApiUrl, {
        method: 'DELETE',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
      })

      if (!fathomResponse.ok && fathomResponse.status !== 404) {
        logger.warn(
          `[${requestId}] Failed to delete Fathom webhook (non-fatal): ${fathomResponse.status}`
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Fathom webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Fathom webhook (non-fatal)`, error)
    }
  },
}
