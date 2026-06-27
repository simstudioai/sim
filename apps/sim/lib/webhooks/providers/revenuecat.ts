import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
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

const logger = createLogger('WebhookProvider:RevenueCat')

/** Base URL for the RevenueCat REST API v2. */
const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v2'

/**
 * RevenueCat webhook handler.
 *
 * RevenueCat does not sign payloads. Instead, the user configures an Authorization
 * header value in the RevenueCat dashboard that is sent verbatim on every request.
 * We verify the incoming `Authorization` header against the configured secret using
 * a timing-safe comparison.
 *
 * @see https://www.revenuecat.com/docs/integrations/webhooks
 */
export const revenueCatHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secret = providerConfig.authHeaderSecret as string | undefined

    if (!secret) {
      logger.debug(
        `[${requestId}] RevenueCat webhook has no Authorization secret configured, skipping verification`
      )
      return null
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      logger.warn(`[${requestId}] RevenueCat webhook missing Authorization header`)
      return new NextResponse('Unauthorized - Missing RevenueCat Authorization header', {
        status: 401,
      })
    }

    if (!safeCompare(authHeader, secret)) {
      logger.warn(`[${requestId}] RevenueCat Authorization header verification failed`)
      return new NextResponse('Unauthorized - Invalid RevenueCat Authorization header', {
        status: 401,
      })
    }

    return null
  },

  /**
   * Create the webhook integration in RevenueCat via the REST API v2.
   *
   * Sim generates the Authorization header secret, registers the integration
   * with that secret, and stores both the returned integration id (`externalId`)
   * and the secret (`authHeaderSecret`) so {@link verifyAuth} can authenticate
   * incoming deliveries.
   *
   * @see https://www.revenuecat.com/docs/api-v2 (Integration > Create a webhook integration)
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const { apiKey, projectId, triggerId, environment } = config as {
      apiKey?: string
      projectId?: string
      triggerId?: string
      environment?: string
    }

    if (!apiKey) {
      throw new Error(
        'RevenueCat Secret API key is required to create the webhook. Provide a v2 Secret API key with the project_configuration:integrations:read_write permission.'
      )
    }

    if (!projectId) {
      throw new Error('RevenueCat Project ID is required to create the webhook.')
    }

    const { REVENUECAT_TRIGGER_TO_API_EVENT_TYPE } = await import('@/triggers/revenuecat/utils')
    const eventType = triggerId ? REVENUECAT_TRIGGER_TO_API_EVENT_TYPE[triggerId] : undefined

    const authHeaderSecret = generateId()
    const requestBody: Record<string, unknown> = {
      name: `Sim webhook (${triggerId ?? 'revenuecat'})`,
      url: getNotificationUrl(ctx.webhook),
      authorization_header: authHeaderSecret,
    }
    if (eventType) {
      requestBody.event_types = [eventType]
    }
    if (environment === 'production' || environment === 'sandbox') {
      requestBody.environment = environment
    }

    const response = await fetch(
      `${REVENUECAT_API_BASE}/projects/${encodeURIComponent(projectId)}/integrations/webhooks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
      logger.error(
        `[${ctx.requestId}] Failed to create RevenueCat webhook for webhook ${ctx.webhook.id}. Status: ${response.status}`,
        { response: errorBody }
      )

      let message = 'Failed to create webhook integration in RevenueCat'
      if (response.status === 401) {
        message = 'RevenueCat authentication failed. Verify your v2 Secret API key is correct.'
      } else if (response.status === 403) {
        message =
          'RevenueCat access denied. Ensure the API key has the project_configuration:integrations:read_write permission.'
      } else if (response.status === 404) {
        message = 'RevenueCat project not found. Verify the Project ID is correct.'
      } else if (typeof errorBody.message === 'string' && errorBody.message.length > 0) {
        message = `RevenueCat error: ${errorBody.message}`
      }
      throw new Error(message)
    }

    const responseBody = (await response.json()) as Record<string, unknown>
    const integrationId = responseBody.id as string | undefined

    if (!integrationId) {
      logger.error(
        `[${ctx.requestId}] RevenueCat webhook created but no integration id was returned for webhook ${ctx.webhook.id}`,
        { response: responseBody }
      )
      throw new Error('RevenueCat webhook creation succeeded but no integration id was returned')
    }

    logger.info(
      `[${ctx.requestId}] Created RevenueCat webhook integration ${integrationId} for webhook ${ctx.webhook.id}`
    )

    return { providerConfigUpdates: { externalId: integrationId, authHeaderSecret } }
  },

  /**
   * Delete the webhook integration in RevenueCat during undeploy.
   *
   * Cleanup is best-effort: a missing integration (404) or a transient failure
   * is logged non-fatally unless strict outbox cleanup is requested.
   *
   * @see https://www.revenuecat.com/docs/api-v2 (Integration > Delete a webhook integration)
   */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const { apiKey, projectId, externalId } = config as {
        apiKey?: string
        projectId?: string
        externalId?: string
      }

      if (!apiKey || !projectId || !externalId) {
        logger.warn(
          `[${ctx.requestId}] Missing apiKey/projectId/externalId for RevenueCat webhook deletion ${ctx.webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing RevenueCat credentials for webhook deletion')
        return
      }

      const response = await fetch(
        `${REVENUECAT_API_BASE}/projects/${encodeURIComponent(projectId)}/integrations/webhooks/${encodeURIComponent(externalId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      )

      if (!response.ok && response.status !== 404) {
        const errorBody = await response.json().catch(() => ({}))
        logger.warn(
          `[${ctx.requestId}] Failed to delete RevenueCat webhook (non-fatal): ${response.status}`,
          { response: errorBody }
        )
        if (ctx.strict) {
          throw new Error(`Failed to delete RevenueCat webhook: ${response.status}`)
        }
      } else {
        logger.info(`[${ctx.requestId}] Deleted RevenueCat webhook integration ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting RevenueCat webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) {
      return true
    }

    const { isRevenueCatEventMatch } = await import('@/triggers/revenuecat/utils')
    if (!isRevenueCatEventMatch(triggerId, (body as Record<string, unknown>) || {})) {
      const event = (body as Record<string, unknown>)?.event as Record<string, unknown> | undefined
      logger.debug(
        `[${requestId}] RevenueCat event type '${event?.type as string | undefined}' does not match trigger ${triggerId}, skipping`
      )
      return false
    }

    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = (body as Record<string, unknown>) || {}
    const event = (payload.event as Record<string, unknown>) || {}

    return {
      input: {
        type: event.type ?? null,
        id: event.id ?? null,
        app_id: event.app_id ?? null,
        event_timestamp_ms: event.event_timestamp_ms ?? null,
        app_user_id: event.app_user_id ?? null,
        original_app_user_id: event.original_app_user_id ?? null,
        aliases: event.aliases ?? null,
        product_id: event.product_id ?? null,
        new_product_id: event.new_product_id ?? null,
        period_type: event.period_type ?? null,
        purchased_at_ms: event.purchased_at_ms ?? null,
        expiration_at_ms: event.expiration_at_ms ?? null,
        environment: event.environment ?? null,
        entitlement_id: event.entitlement_id ?? null,
        entitlement_ids: event.entitlement_ids ?? null,
        presented_offering_id: event.presented_offering_id ?? null,
        transaction_id: event.transaction_id ?? null,
        original_transaction_id: event.original_transaction_id ?? null,
        is_family_share: event.is_family_share ?? null,
        country_code: event.country_code ?? null,
        currency: event.currency ?? null,
        price: event.price ?? null,
        price_in_purchased_currency: event.price_in_purchased_currency ?? null,
        store: event.store ?? null,
        takehome_percentage: event.takehome_percentage ?? null,
        tax_percentage: event.tax_percentage ?? null,
        commission_percentage: event.commission_percentage ?? null,
        offer_code: event.offer_code ?? null,
        subscriber_attributes: event.subscriber_attributes ?? null,
        experiments: event.experiments ?? null,
        cancel_reason: event.cancel_reason ?? null,
        expiration_reason: event.expiration_reason ?? null,
        api_version: payload.api_version ?? null,
        event,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const event = (body as Record<string, unknown>)?.event as Record<string, unknown> | undefined
    const id = event?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  },
}
