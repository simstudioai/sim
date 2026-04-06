import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import { generateId } from '@/lib/core/utils/uuid'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:Linear')

function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Linear signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

export const linearHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'Linear-Signature',
    validateFn: validateLinearSignature,
    providerLabel: 'Linear',
  }),

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        action: b.action || '',
        type: b.type || '',
        webhookId: b.webhookId || '',
        webhookTimestamp: b.webhookTimestamp || 0,
        organizationId: b.organizationId || '',
        createdAt: b.createdAt || '',
        actor: b.actor || null,
        data: b.data || null,
        updatedFrom: b.updatedFrom || null,
      },
    }
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId && !triggerId.endsWith('_webhook') && !triggerId.endsWith('_webhook_v2')) {
      const { isLinearEventMatch } = await import('@/triggers/linear/utils')
      const obj = body as Record<string, unknown>
      const action = obj.action as string | undefined
      const type = obj.type as string | undefined
      if (!isLinearEventMatch(triggerId, type || '', action)) {
        logger.debug(
          `[${requestId}] Linear event mismatch for trigger ${triggerId}. Type: ${type}, Action: ${action}. Skipping.`
        )
        return false
      }
    }
    return true
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const triggerId = config.triggerId as string | undefined

    if (!triggerId || !triggerId.endsWith('_v2')) {
      return undefined
    }

    const apiKey = config.apiKey as string | undefined
    if (!apiKey) {
      logger.warn(`[${ctx.requestId}] Missing API key for Linear webhook ${ctx.webhook.id}`)
      throw new Error(
        'Linear API key is required. Please provide a valid API key in the trigger configuration.'
      )
    }

    const { LINEAR_RESOURCE_TYPE_MAP } = await import('@/triggers/linear/utils')
    const resourceTypes = LINEAR_RESOURCE_TYPE_MAP[triggerId]
    if (!resourceTypes) {
      logger.warn(`[${ctx.requestId}] Unknown Linear trigger ID: ${triggerId}`)
      throw new Error(`Unknown Linear trigger type: ${triggerId}`)
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const webhookSecret = generateId()
    const teamId = config.teamId as string | undefined

    const input: Record<string, unknown> = {
      url: notificationUrl,
      resourceTypes,
      secret: webhookSecret,
      enabled: true,
    }

    if (teamId) {
      input.teamId = teamId
    } else {
      input.allPublicTeams = true
    }

    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          query: `mutation WebhookCreate($input: WebhookCreateInput!) {
            webhookCreate(input: $input) {
              success
              webhook { id enabled }
            }
          }`,
          variables: { input },
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Linear API returned HTTP ${response.status}. Please verify your API key and try again.`
        )
      }

      const data = await response.json()
      const result = data?.data?.webhookCreate

      if (!result?.success) {
        const errors = data?.errors?.map((e: { message: string }) => e.message).join(', ')
        logger.error(`[${ctx.requestId}] Failed to create Linear webhook`, {
          errors,
          webhookId: ctx.webhook.id,
        })
        throw new Error(errors || 'Failed to create Linear webhook. Please verify your API key.')
      }

      const externalId = result.webhook?.id
      logger.info(
        `[${ctx.requestId}] Created Linear webhook ${externalId} for webhook ${ctx.webhook.id}`
      )

      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret,
        },
      }
    } catch (error) {
      if (error instanceof Error && error.message !== 'fetch failed') {
        throw error
      }
      logger.error(`[${ctx.requestId}] Error creating Linear webhook`, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error('Failed to create Linear webhook. Please verify your API key and try again.')
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const externalId = config.externalId as string | undefined
    const apiKey = config.apiKey as string | undefined

    if (!externalId || !apiKey) {
      return
    }

    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          query: `mutation WebhookDelete($id: String!) {
            webhookDelete(id: $id) { success }
          }`,
          variables: { id: externalId },
        }),
      })

      if (!response.ok) {
        logger.warn(
          `[${ctx.requestId}] Linear API returned HTTP ${response.status} during webhook deletion for ${externalId}`
        )
        return
      }

      const data = await response.json()
      if (data?.data?.webhookDelete?.success) {
        logger.info(
          `[${ctx.requestId}] Deleted Linear webhook ${externalId} for webhook ${ctx.webhook.id}`
        )
      } else {
        logger.warn(
          `[${ctx.requestId}] Linear webhook deletion returned unsuccessful for ${externalId}`
        )
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Linear webhook ${externalId} (non-fatal)`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const data = obj.data as Record<string, unknown> | undefined
    if (obj.action && data?.id) {
      return `${obj.action}:${data.id}`
    }
    return null
  },
}
