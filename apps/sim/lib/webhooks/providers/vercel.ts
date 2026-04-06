import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Vercel')

export const vercelHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'x-vercel-signature',
    validateFn: (secret, signature, body) => {
      const hash = crypto.createHmac('sha1', secret).update(body, 'utf8').digest('hex')
      return safeCompare(hash, signature)
    },
    providerLabel: 'Vercel',
  }),

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const teamId = providerConfig.teamId as string | undefined
      const filterProjectIds = providerConfig.filterProjectIds as string | undefined

      if (!apiKey) {
        throw new Error(
          'Vercel Access Token is required. Please provide your access token in the trigger configuration.'
        )
      }

      const eventTypeMap: Record<string, string[] | undefined> = {
        vercel_deployment_created: ['deployment.created'],
        vercel_deployment_ready: ['deployment.ready'],
        vercel_deployment_error: ['deployment.error'],
        vercel_deployment_canceled: ['deployment.canceled'],
        vercel_project_created: ['project.created'],
        vercel_project_removed: ['project.removed'],
        vercel_domain_created: ['domain.created'],
        vercel_webhook: undefined,
      }

      if (triggerId && !(triggerId in eventTypeMap)) {
        logger.warn(
          `[${requestId}] Unknown triggerId for Vercel: ${triggerId}, defaulting to all events`,
          { triggerId, webhookId: webhook.id }
        )
      }

      const events = eventTypeMap[triggerId ?? '']
      const notificationUrl = getNotificationUrl(webhook)

      logger.info(`[${requestId}] Creating Vercel webhook`, {
        triggerId,
        events,
        hasTeamId: !!teamId,
        hasProjectIds: !!filterProjectIds,
        webhookId: webhook.id,
      })

      /**
       * Vercel requires an explicit events list — there is no "subscribe to all" option.
       * For the generic webhook trigger, we subscribe to the most commonly useful events.
       * Full list: https://vercel.com/docs/webhooks/webhooks-api#event-types
       */
      const requestBody: Record<string, unknown> = {
        url: notificationUrl,
        events: events || [
          'deployment.created',
          'deployment.ready',
          'deployment.succeeded',
          'deployment.error',
          'deployment.canceled',
          'deployment.promoted',
          'project.created',
          'project.removed',
          'domain.created',
          'edge-config.created',
          'edge-config.deleted',
        ],
      }

      if (filterProjectIds) {
        const projectIds = String(filterProjectIds)
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean)
        if (projectIds.length > 0) {
          requestBody.projectIds = projectIds
        }
      }

      const apiUrl = teamId
        ? `https://api.vercel.com/v1/webhooks?teamId=${encodeURIComponent(teamId)}`
        : 'https://api.vercel.com/v1/webhooks'

      const vercelResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await vercelResponse.json().catch(() => ({}))) as Record<
        string,
        unknown
      >

      if (!vercelResponse.ok) {
        const errorObj = responseBody.error as Record<string, unknown> | undefined
        const errorMessage =
          (errorObj?.message as string) ||
          (responseBody.message as string) ||
          'Unknown Vercel API error'

        let userFriendlyMessage = 'Failed to create webhook subscription in Vercel'
        if (vercelResponse.status === 401 || vercelResponse.status === 403) {
          userFriendlyMessage =
            'Invalid or insufficient Vercel Access Token. Please verify your token has the correct permissions.'
        } else if (errorMessage && errorMessage !== 'Unknown Vercel API error') {
          userFriendlyMessage = `Vercel error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const externalId = responseBody.id as string | undefined
      if (!externalId) {
        throw new Error('Vercel webhook creation succeeded but no webhook ID was returned')
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Vercel for webhook ${webhook.id}.`,
        { vercelWebhookId: externalId }
      )

      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret: (responseBody.secret as string) || '',
        },
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Vercel webhook creation for webhook ${webhook.id}.`,
        { message: err.message, stack: err.stack }
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
      const teamId = config.teamId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing apiKey or externalId for Vercel webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const apiUrl = teamId
        ? `https://api.vercel.com/v1/webhooks/${encodeURIComponent(externalId)}?teamId=${encodeURIComponent(teamId)}`
        : `https://api.vercel.com/v1/webhooks/${encodeURIComponent(externalId)}`

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok && response.status !== 404) {
        logger.warn(
          `[${requestId}] Failed to delete Vercel webhook (non-fatal): ${response.status}`
        )
      } else {
        await response.body?.cancel()
        logger.info(`[${requestId}] Successfully deleted Vercel webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Vercel webhook (non-fatal)`, error)
    }
  },

  async formatInput(ctx: FormatInputContext): Promise<FormatInputResult> {
    const body = ctx.body as Record<string, unknown>
    const payload = (body.payload || {}) as Record<string, unknown>

    return {
      input: {
        type: body.type || '',
        id: body.id || '',
        createdAt: body.createdAt || 0,
        region: body.region || null,
        payload,
        deployment: payload.deployment || null,
        project: payload.project || null,
        team: payload.team || null,
        user: payload.user || null,
        target: payload.target || null,
        plan: payload.plan || null,
        domain: payload.domain || null,
      },
    }
  },
}
