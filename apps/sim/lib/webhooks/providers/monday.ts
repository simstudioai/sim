import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { validateMondayNumericId } from '@/lib/core/security/input-validation'
import { toError } from '@/lib/core/utils/helpers'
import {
  getCredentialOwner,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Monday')

const MONDAY_API_URL = 'https://api.monday.com/v2'

/**
 * Resolves an OAuth access token from the webhook's credential configuration.
 * Follows the Airtable pattern: credentialId → getCredentialOwner → refreshAccessTokenIfNeeded.
 */
async function resolveAccessToken(
  config: Record<string, unknown>,
  userId: string,
  requestId: string
): Promise<string> {
  const credentialId = config.credentialId as string | undefined

  if (credentialId) {
    const credentialOwner = await getCredentialOwner(credentialId, requestId)
    if (credentialOwner) {
      const token = await refreshAccessTokenIfNeeded(
        credentialOwner.accountId,
        credentialOwner.userId,
        requestId
      )
      if (token) return token
    }
  }

  const fallbackToken = await getOAuthToken(userId, 'monday')
  if (fallbackToken) return fallbackToken

  throw new Error(
    'Monday.com account connection required. Please connect your Monday.com account in the trigger configuration and try again.'
  )
}

export const mondayHandler: WebhookProviderHandler = {
  /**
   * Handle Monday.com's webhook challenge verification.
   * When a webhook is created, Monday.com sends a POST with `{"challenge": "..."}`.
   * We must echo back `{"challenge": "..."}` with a 200 status.
   */
  handleChallenge(body: unknown) {
    const payload = body as Record<string, unknown>
    // Monday.com challenges have a `challenge` string field but no `type` field
    // (Slack challenges use `type: 'url_verification'`). Check both conditions
    // to avoid intercepting challenges meant for other providers.
    if (payload && typeof payload.challenge === 'string' && !('type' in payload)) {
      logger.info('Monday.com webhook challenge received, echoing back')
      return NextResponse.json({ challenge: payload.challenge }, { status: 200 })
    }
    return null
  },

  /**
   * Create a Monday.com webhook subscription via their GraphQL API.
   * Monday.com webhooks are board-scoped and event-type-specific.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const triggerId = config.triggerId as string | undefined
    const boardId = config.boardId as string | undefined

    if (!triggerId) {
      logger.warn(`[${ctx.requestId}] Missing triggerId for Monday webhook ${ctx.webhook.id}`)
      throw new Error('Trigger type is required for Monday.com webhook creation.')
    }

    if (!boardId) {
      logger.warn(`[${ctx.requestId}] Missing boardId for Monday webhook ${ctx.webhook.id}`)
      throw new Error(
        'Board ID is required. Please provide a valid Monday.com board ID in the trigger configuration.'
      )
    }

    const boardIdValidation = validateMondayNumericId(boardId, 'boardId')
    if (!boardIdValidation.isValid) {
      throw new Error(boardIdValidation.error!)
    }

    const { MONDAY_EVENT_TYPE_MAP } = await import('@/triggers/monday/utils')
    const eventType = MONDAY_EVENT_TYPE_MAP[triggerId]
    if (!eventType) {
      logger.warn(`[${ctx.requestId}] Unknown Monday trigger ID: ${triggerId}`)
      throw new Error(`Unknown Monday.com trigger type: ${triggerId}`)
    }

    const accessToken = await resolveAccessToken(config, ctx.userId, ctx.requestId)
    const notificationUrl = getNotificationUrl(ctx.webhook)

    try {
      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-Version': '2024-10',
          Authorization: accessToken,
        },
        body: JSON.stringify({
          query: `mutation { create_webhook(board_id: ${boardIdValidation.sanitized}, url: ${JSON.stringify(notificationUrl)}, event: ${eventType}) { id board_id } }`,
        }),
      })

      if (!response.ok) {
        throw new Error(
          `Monday.com API returned HTTP ${response.status}. Please verify your account connection and try again.`
        )
      }

      const data = await response.json()
      const errors = data.errors as Array<{ message: string }> | undefined

      if (errors && errors.length > 0) {
        const errorMsg = errors.map((e) => e.message).join(', ')
        logger.error(`[${ctx.requestId}] Failed to create Monday webhook`, {
          errors: errorMsg,
          webhookId: ctx.webhook.id,
        })
        throw new Error(errorMsg || 'Failed to create Monday.com webhook.')
      }

      if (data.error_message) {
        throw new Error(data.error_message as string)
      }

      const result = data.data?.create_webhook
      if (!result?.id) {
        throw new Error(
          'Monday.com webhook was created but the API response did not include a webhook ID.'
        )
      }

      const externalId = String(result.id)

      logger.info(
        `[${ctx.requestId}] Created Monday webhook ${externalId} for webhook ${ctx.webhook.id} (event: ${eventType}, board: ${boardId})`
      )

      return {
        providerConfigUpdates: {
          externalId,
        },
      }
    } catch (error) {
      if (error instanceof Error && error.message !== 'fetch failed') {
        throw error
      }
      logger.error(`[${ctx.requestId}] Error creating Monday webhook`, {
        error: toError(error).message,
      })
      throw new Error(
        'Failed to create Monday.com webhook. Please verify your account connection and board ID, then try again.'
      )
    }
  },

  /**
   * Delete a Monday.com webhook subscription via their GraphQL API.
   * Errors are logged but not thrown (non-fatal cleanup).
   */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const externalId = config.externalId as string | undefined

    if (!externalId) {
      return
    }

    const externalIdValidation = validateMondayNumericId(externalId, 'webhookId')
    if (!externalIdValidation.isValid) {
      logger.warn(
        `[${ctx.requestId}] Invalid externalId format for Monday webhook deletion: ${externalId}`
      )
      return
    }

    let accessToken: string | null = null
    try {
      const credentialId = config.credentialId as string | undefined
      if (credentialId) {
        const credentialOwner = await getCredentialOwner(credentialId, ctx.requestId)
        if (credentialOwner) {
          accessToken = await refreshAccessTokenIfNeeded(
            credentialOwner.accountId,
            credentialOwner.userId,
            ctx.requestId
          )
        }
      }
    } catch (error) {
      logger.warn(
        `[${ctx.requestId}] Could not resolve credentials for Monday webhook deletion (non-fatal)`,
        { error: toError(error).message }
      )
    }

    if (!accessToken) {
      logger.warn(
        `[${ctx.requestId}] No access token available for Monday webhook deletion ${externalId} (non-fatal)`
      )
      return
    }

    try {
      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-Version': '2024-10',
          Authorization: accessToken,
        },
        body: JSON.stringify({
          query: `mutation { delete_webhook(id: ${externalIdValidation.sanitized}) { id board_id } }`,
        }),
      })

      if (!response.ok) {
        logger.warn(
          `[${ctx.requestId}] Monday API returned HTTP ${response.status} during webhook deletion for ${externalId}`
        )
        return
      }

      const data = await response.json()

      if (data.errors?.length > 0 || data.error_message) {
        const errorMsg =
          data.errors?.map((e: { message: string }) => e.message).join(', ') ||
          data.error_message ||
          'Unknown error'
        logger.warn(
          `[${ctx.requestId}] Monday webhook deletion GraphQL error for ${externalId}: ${errorMsg}`
        )
        return
      }

      if (data.data?.delete_webhook?.id) {
        logger.info(
          `[${ctx.requestId}] Deleted Monday webhook ${externalId} for webhook ${ctx.webhook.id}`
        )
      } else {
        logger.warn(`[${ctx.requestId}] Monday webhook deletion returned no data for ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting Monday webhook ${externalId} (non-fatal)`, {
        error: toError(error).message,
      })
    }
  },

  /**
   * Transform Monday.com webhook payload into trigger output format.
   * Extracts fields from the `event` object and flattens them to match trigger outputs.
   */
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = body as Record<string, unknown>
    const event = payload.event as Record<string, unknown> | undefined

    if (!event) {
      return {
        input: payload,
      }
    }

    const input: Record<string, unknown> = {
      boardId: event.boardId ? String(event.boardId) : null,
      itemId: event.pulseId ? String(event.pulseId) : event.itemId ? String(event.itemId) : null,
      itemName: (event.pulseName as string) ?? null,
      groupId: (event.groupId as string) ?? null,
      userId: event.userId ? String(event.userId) : null,
      triggerTime: (event.triggerTime as string) ?? null,
      triggerUuid: (event.triggerUuid as string) ?? null,
      subscriptionId: event.subscriptionId ? String(event.subscriptionId) : null,
    }

    if (event.columnId !== undefined) {
      input.columnId = (event.columnId as string) ?? null
      input.columnType = (event.columnType as string) ?? null
      input.columnTitle = (event.columnTitle as string) ?? null
      input.value = event.value ?? null
      input.previousValue = event.previousValue ?? null
    }

    if (event.destGroupId !== undefined) {
      input.destGroupId = (event.destGroupId as string) ?? null
      input.sourceGroupId = (event.sourceGroupId as string) ?? null
    }

    if (event.parentItemId !== undefined) {
      input.parentItemId = event.parentItemId ? String(event.parentItemId) : null
      input.parentItemBoardId = event.parentItemBoardId ? String(event.parentItemBoardId) : null
    }

    if (event.updateId !== undefined) {
      input.updateId = event.updateId ? String(event.updateId) : null
      input.body = (event.body as string) ?? null
      input.textBody = (event.textBody as string) ?? null
    }

    return { input }
  },

  /**
   * Extract idempotency ID from Monday.com webhook payload.
   * Uses the unique triggerUuid provided by Monday.com.
   */
  extractIdempotencyId(body: unknown): string | null {
    const payload = body as Record<string, unknown>
    const event = payload.event as Record<string, unknown> | undefined
    if (event?.triggerUuid) {
      return String(event.triggerUuid)
    }
    return null
  },
}
