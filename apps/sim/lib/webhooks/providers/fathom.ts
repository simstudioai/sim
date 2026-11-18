import { createLogger } from '@sim/logger'
import type { NextResponse } from 'next/server'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyStandardWebhookRequest } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Fathom')

/**
 * Deletes a Fathom webhook. A `404` counts as deleted, since the webhook is already gone.
 *
 * @returns The HTTP status of a failed delete, or `undefined` once the webhook is gone.
 */
async function deleteFathomWebhook(
  apiKey: string,
  fathomWebhookId: string
): Promise<number | undefined> {
  const response = await outboundFetch(
    `https://api.fathom.ai/external/v1/webhooks/${fathomWebhookId}`,
    {
      method: 'DELETE',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    }
  )
  return !response.ok && response.status !== 404 ? response.status : undefined
}

/** Best-effort removal of a webhook Sim registered but cannot keep, so it does not keep firing. */
async function deleteOrphanedFathomWebhook(
  apiKey: string,
  fathomWebhookId: string,
  requestId: string
): Promise<void> {
  if (!validateAlphanumericId(fathomWebhookId, 'Fathom webhook ID', 100).isValid) return
  try {
    const failedStatus = await deleteFathomWebhook(apiKey, fathomWebhookId)
    if (failedStatus !== undefined) {
      logger.warn('Failed to remove orphaned Fathom webhook; it may still be active', {
        requestId,
        status: failedStatus,
      })
    }
  } catch (error) {
    logger.warn('Failed to remove orphaned Fathom webhook; it may still be active', error, {
      requestId,
    })
  }
}

export const fathomHandler: WebhookProviderHandler = {
  /**
   * Fathom signs deliveries with the Standard Webhooks scheme using the secret
   * returned when Sim registers the webhook. Rows registered before Sim stored
   * that secret have none and keep being accepted until the trigger's settings
   * change or it is re-created, which registers a new webhook and stores its secret.
   */
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret?.trim()) return null

    return verifyStandardWebhookRequest({
      request,
      rawBody,
      requestId,
      secret: signingSecret,
      providerLabel: 'Fathom',
    })
  },

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
        logger.warn('Missing apiKey for Fathom webhook creation.', {
          requestId,
          webhookId: webhook.id,
        })
        throw new WebhookDeploymentConfigurationError(
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

      logger.info('Creating Fathom webhook', {
        requestId,
        triggerId,
        triggeredFor: triggeredForValue,
        webhookId: webhook.id,
      })

      const fathomResponse = await outboundFetch('https://api.fathom.ai/external/v1/webhooks', {
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
          `Failed to create webhook in Fathom for webhook ${webhook.id}. Status: ${fathomResponse.status}`,
          { requestId, message: errorMessage, response: responseBody }
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
          `Fathom webhook creation returned success but no webhook ID for ${webhook.id}.`,
          { requestId }
        )
        throw new Error('Fathom webhook created but no ID returned. Please try again.')
      }

      logger.info(`Successfully created webhook in Fathom for webhook ${webhook.id}.`, {
        requestId,
        fathomWebhookId: responseBody.id,
      })

      const signingSecret =
        typeof responseBody.secret === 'string' ? responseBody.secret.trim() : ''
      if (!signingSecret) {
        logger.error('Fathom webhook creation returned no signing secret', {
          requestId,
          webhookId: webhook.id,
        })
        await deleteOrphanedFathomWebhook(apiKey, String(responseBody.id), requestId)
        throw new Error(
          'Fathom created the webhook but did not return a signing secret, so deliveries could not be verified. Please try again.'
        )
      }

      return { providerConfigUpdates: { externalId: responseBody.id, signingSecret } }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const err = error as Error
      logger.error(`Exception during Fathom webhook creation for webhook ${webhook.id}.`, {
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

      if (!apiKey) {
        logger.warn(`Missing apiKey for Fathom webhook deletion ${webhook.id}, skipping cleanup`, {
          requestId,
        })
        if (ctx.strict) throw new Error('Missing Fathom apiKey for webhook deletion')
        return
      }

      if (!externalId) {
        logger.warn(
          `Missing externalId for Fathom webhook deletion ${webhook.id}, skipping cleanup`,
          { requestId }
        )
        if (ctx.strict) throw new Error('Missing Fathom externalId for webhook deletion')
        return
      }

      const idValidation = validateAlphanumericId(externalId, 'Fathom webhook ID', 100)
      if (!idValidation.isValid) {
        logger.warn(
          `Invalid externalId format for Fathom webhook deletion ${webhook.id}, skipping cleanup`,
          { requestId }
        )
        if (ctx.strict) throw new Error('Invalid Fathom externalId for webhook deletion')
        return
      }

      const failedStatus = await deleteFathomWebhook(apiKey, externalId)

      if (failedStatus !== undefined) {
        logger.warn(`Failed to delete Fathom webhook (non-fatal): ${failedStatus}`, {
          requestId,
        })
        if (ctx.strict) throw new Error(`Failed to delete Fathom webhook: ${failedStatus}`)
      } else {
        logger.info(`Successfully deleted Fathom webhook ${externalId}`, { requestId })
      }
    } catch (error) {
      logger.warn('Error deleting Fathom webhook (non-fatal)', error, { requestId })
      if (ctx.strict) throw error
    }
  },
}
