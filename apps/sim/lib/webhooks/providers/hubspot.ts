import { createLogger } from '@sim/logger'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:HubSpot')

export const hubspotHandler: WebhookProviderHandler = {
  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId?.startsWith('hubspot_')) {
      const events = Array.isArray(body) ? body : [body]
      const firstEvent = events[0] as Record<string, unknown> | undefined
      const subscriptionType = firstEvent?.subscriptionType as string | undefined

      const { isHubSpotContactEventMatch } = await import('@/triggers/hubspot/utils')
      if (!isHubSpotContactEventMatch(triggerId, subscriptionType || '')) {
        logger.debug(
          `[${requestId}] HubSpot event mismatch for trigger ${triggerId}. Event: ${subscriptionType}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: subscriptionType,
          }
        )
        return false
      }

      logger.info(
        `[${requestId}] HubSpot event match confirmed for trigger ${triggerId}. Event: ${subscriptionType}`,
        {
          webhookId: webhook.id,
          workflowId: workflow.id,
          triggerId,
          receivedEvent: subscriptionType,
        }
      )
    }

    return true
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const events = Array.isArray(b) ? b : [b]
    const event = events[0] as Record<string, unknown> | undefined
    if (!event) {
      logger.warn('HubSpot webhook received with empty payload')
      return { input: null }
    }
    logger.info('Formatting HubSpot webhook input', {
      subscriptionType: event.subscriptionType,
      objectId: event.objectId,
      portalId: event.portalId,
    })
    return {
      input: { payload: body, provider: 'hubspot', providerConfig: webhook.providerConfig },
    }
  },

  extractIdempotencyId(body: unknown) {
    if (Array.isArray(body) && body.length > 0) {
      const first = body[0] as Record<string, unknown>
      if (first?.eventId) {
        return String(first.eventId)
      }
    }
    return null
  },
}
