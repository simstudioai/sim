import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import { toError } from '@/lib/core/utils/helpers'
import { generateId } from '@/lib/core/utils/uuid'
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

const LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

export const linearHandler: WebhookProviderHandler = {
  async verifyAuth({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      return null
    }

    const signature = request.headers.get('Linear-Signature')
    if (!signature) {
      logger.warn(`[${requestId}] Linear webhook missing signature header`)
      return new NextResponse('Unauthorized - Missing Linear signature', { status: 401 })
    }

    if (!validateLinearSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] Linear signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Linear signature', { status: 401 })
    }

    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      const ts = parsed.webhookTimestamp
      if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        logger.warn(`[${requestId}] Linear webhookTimestamp missing or invalid`)
        return new NextResponse('Unauthorized - Invalid webhook timestamp', {
          status: 401,
        })
      }

      if (Math.abs(Date.now() - ts) > LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS) {
        logger.warn(
          `[${requestId}] Linear webhookTimestamp outside allowed skew (${LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS}ms)`
        )
        return new NextResponse('Unauthorized - Webhook timestamp skew too large', {
          status: 401,
        })
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Linear webhook body parse failed after signature verification`,
        error
      )
      return new NextResponse('Unauthorized - Invalid webhook body', { status: 401 })
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const rawActor = b.actor
    let actor: unknown = null
    if (rawActor && typeof rawActor === 'object' && !Array.isArray(rawActor)) {
      const a = rawActor as Record<string, unknown>
      const { type: linearActorType, ...rest } = a
      actor = {
        ...rest,
        actorType: typeof linearActorType === 'string' ? linearActorType : null,
      }
    }

    return {
      input: {
        action: b.action || '',
        type: b.type || '',
        webhookId: b.webhookId || '',
        webhookTimestamp: b.webhookTimestamp || 0,
        organizationId: b.organizationId || '',
        createdAt: b.createdAt || '',
        url: typeof b.url === 'string' ? b.url : '',
        actor,
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
      if (typeof externalId !== 'string' || !externalId.trim()) {
        throw new Error(
          'Linear webhook was created but the API response did not include a webhook id.'
        )
      }

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
        error: toError(error).message,
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
        error: toError(error).message,
      })
    }
  },
}
