import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { skipByEventTypes } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Grain')

export const grainHandler: WebhookProviderHandler = {
  handleReachabilityTest(body: unknown, requestId: string) {
    const obj = body as Record<string, unknown> | null
    const isVerificationRequest = !obj || Object.keys(obj).length === 0 || !obj.type
    if (isVerificationRequest) {
      logger.info(
        `[${requestId}] Grain reachability test detected - returning 200 for webhook verification`
      )
      return NextResponse.json({
        status: 'ok',
        message: 'Webhook endpoint verified',
      })
    }
    return null
  },

  shouldSkipEvent(ctx: EventFilterContext) {
    return skipByEventTypes(ctx, 'Grain', logger)
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return { input: { type: b.type, user_id: b.user_id, data: b.data || {} } }
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (obj.type && data?.id) {
      return `${obj.type}:${data.id}`
    }
    return null
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const viewId = providerConfig.viewId as string | undefined

      if (!apiKey) {
        logger.warn(`[${requestId}] Missing apiKey for Grain webhook creation.`, {
          webhookId: webhook.id,
        })
        throw new Error(
          'Grain API Key is required. Please provide your Grain Personal Access Token in the trigger configuration.'
        )
      }

      if (!viewId) {
        logger.warn(`[${requestId}] Missing viewId for Grain webhook creation.`, {
          webhookId: webhook.id,
          triggerId,
        })
        throw new Error(
          'Grain view ID is required. Please provide the Grain view ID from GET /_/public-api/views in the trigger configuration.'
        )
      }

      const actionMap: Record<string, Array<'added' | 'updated' | 'removed'>> = {
        grain_item_added: ['added'],
        grain_item_updated: ['updated'],
        grain_recording_created: ['added'],
        grain_recording_updated: ['updated'],
        grain_highlight_created: ['added'],
        grain_highlight_updated: ['updated'],
        grain_story_created: ['added'],
      }

      const eventTypeMap: Record<string, string[]> = {
        grain_webhook: [],
        grain_item_added: [],
        grain_item_updated: [],
        grain_recording_created: ['recording_added'],
        grain_recording_updated: ['recording_updated'],
        grain_highlight_created: ['highlight_added'],
        grain_highlight_updated: ['highlight_updated'],
        grain_story_created: ['story_added'],
      }

      const actions = actionMap[triggerId ?? ''] ?? []
      const eventTypes = eventTypeMap[triggerId ?? ''] ?? []

      if (!triggerId || (!(triggerId in actionMap) && triggerId !== 'grain_webhook')) {
        logger.warn(
          `[${requestId}] Unknown triggerId for Grain: ${triggerId}, defaulting to all actions`,
          {
            webhookId: webhook.id,
          }
        )
      }

      logger.info(`[${requestId}] Creating Grain webhook`, {
        triggerId,
        viewId,
        actions,
        eventTypes,
        webhookId: webhook.id,
      })

      const notificationUrl = getNotificationUrl(webhook)

      const grainApiUrl = 'https://api.grain.com/_/public-api/hooks'

      const requestBody: Record<string, unknown> = {
        version: 2,
        hook_url: notificationUrl,
        view_id: viewId,
      }
      if (actions.length > 0) {
        requestBody.actions = actions
      }

      const grainResponse = await fetch(grainApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await grainResponse.json()) as Record<string, unknown>

      if (!grainResponse.ok || responseBody.error || responseBody.errors) {
        const errors = responseBody.errors as Record<string, string> | undefined
        const error = responseBody.error as Record<string, string> | string | undefined
        const errorMessage =
          errors?.detail ||
          (typeof error === 'object' ? error?.message : undefined) ||
          (typeof error === 'string' ? error : undefined) ||
          (responseBody.message as string) ||
          'Unknown Grain API error'
        logger.error(
          `[${requestId}] Failed to create webhook in Grain for webhook ${webhook.id}. Status: ${grainResponse.status}`,
          { message: errorMessage, response: responseBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Grain'
        if (grainResponse.status === 401) {
          userFriendlyMessage =
            'Invalid Grain API Key. Please verify your Personal Access Token is correct.'
        } else if (grainResponse.status === 403) {
          userFriendlyMessage =
            'Access denied. Please ensure your Grain API Key has appropriate permissions.'
        } else if (errorMessage && errorMessage !== 'Unknown Grain API error') {
          userFriendlyMessage = `Grain error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const grainWebhookId = responseBody.id as string | undefined

      if (!grainWebhookId) {
        logger.error(
          `[${requestId}] Grain webhook creation response missing id for webhook ${webhook.id}.`,
          {
            response: responseBody,
          }
        )
        throw new Error(
          'Grain webhook created but no webhook ID was returned in the response. Cannot track subscription.'
        )
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Grain for webhook ${webhook.id}.`,
        {
          grainWebhookId,
          eventTypes,
        }
      )

      return { providerConfigUpdates: { externalId: grainWebhookId, eventTypes } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Grain webhook creation for webhook ${webhook.id}.`,
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
          `[${requestId}] Missing apiKey for Grain webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      if (!externalId) {
        logger.warn(
          `[${requestId}] Missing externalId for Grain webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const grainApiUrl = `https://api.grain.com/_/public-api/hooks/${externalId}`

      const grainResponse = await fetch(grainApiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!grainResponse.ok && grainResponse.status !== 404) {
        const responseBody = await grainResponse.json().catch(() => ({}))
        logger.warn(
          `[${requestId}] Failed to delete Grain webhook (non-fatal): ${grainResponse.status}`,
          { response: responseBody }
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Grain webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Grain webhook (non-fatal)`, error)
    }
  },
}
