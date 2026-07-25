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
import { GRAIN_V2_TRIGGER_TO_HOOK_TYPES } from '@/triggers/grain/utils'

const logger = createLogger('WebhookProvider:Grain')

const GRAIN_V2_HOOKS_BASE = 'https://api.grain.com/_/public-api/v2/hooks'
const GRAIN_API_VERSION = '2025-10-31'

function grainErrorMessage(responseBody: Record<string, unknown>): string {
  const errors = responseBody.errors as Record<string, string> | undefined
  const error = responseBody.error as Record<string, string> | string | undefined
  return (
    errors?.detail ||
    (typeof error === 'object' ? error?.message : undefined) ||
    (typeof error === 'string' ? error : undefined) ||
    (responseBody.message as string) ||
    'Unknown Grain API error'
  )
}

function grainUserFacingError(status: number, errorMessage: string): string {
  if (status === 401) {
    return 'Invalid Grain API Key. Please verify your access token is correct.'
  }
  if (status === 403) {
    return 'Access denied. Please ensure your Grain API Key has appropriate permissions.'
  }
  if (errorMessage && errorMessage !== 'Unknown Grain API error') {
    return `Grain error: ${errorMessage}`
  }
  return 'Failed to create webhook subscription in Grain'
}

/**
 * Creates one Grain v2 hook per requested hook type. The v2 API has no
 * multi-event hooks, so a trigger subscribing to several event types owns
 * several external hooks — their ids are all recorded in `externalIds`.
 * Hooks already created on a previous partial attempt are deleted before
 * rethrowing so a failed prepare never leaks subscriptions.
 */
async function createGrainV2Hooks(params: {
  apiKey: string
  notificationUrl: string
  hookTypes: string[]
  requestId: string
  webhookId: string
}): Promise<string[]> {
  const { apiKey, notificationUrl, hookTypes, requestId, webhookId } = params
  const createdIds: string[] = []

  try {
    for (const hookType of hookTypes) {
      const response = await fetch(`${GRAIN_V2_HOOKS_BASE}/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Public-Api-Version': GRAIN_API_VERSION,
        },
        body: JSON.stringify({ hook_url: notificationUrl, hook_type: hookType }),
      })
      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>

      if (!response.ok || responseBody.error || responseBody.errors) {
        const message = grainErrorMessage(responseBody)
        logger.error(
          `[${requestId}] Failed to create Grain v2 hook (${hookType}) for webhook ${webhookId}. Status: ${response.status}`,
          { message, response: responseBody }
        )
        throw new Error(grainUserFacingError(response.status, message))
      }

      const hookId = responseBody.id as string | undefined
      if (!hookId) {
        throw new Error(
          `Grain webhook (${hookType}) created but no webhook ID was returned in the response.`
        )
      }
      createdIds.push(hookId)
    }
    return createdIds
  } catch (error) {
    await Promise.allSettled(
      createdIds.map((hookId) =>
        deleteGrainV2Hook({ apiKey, hookId, requestId }).catch(() => undefined)
      )
    )
    throw error
  }
}

async function deleteGrainV2Hook(params: {
  apiKey: string
  hookId: string
  requestId: string
}): Promise<void> {
  const response = await fetch(`${GRAIN_V2_HOOKS_BASE}/${params.hookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'Public-Api-Version': GRAIN_API_VERSION,
    },
  })
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Failed to delete Grain webhook ${params.hookId}: ${response.status}`)
  }
}

/**
 * Legacy v1 view-scoped hook creation, preserved verbatim for triggers created
 * before the v2 migration. Not remapped to v2 on purpose: v2 has no view
 * scoping, so a silent remap would widen what fires the workflow. When Grain
 * sunsets v1 (2026-09-07) these deploys fail with Grain's error and the user
 * must reconfigure onto the Grain Events trigger.
 */
async function createLegacyV1Subscription(params: {
  apiKey: string
  triggerId: string | undefined
  viewId: string | undefined
  notificationUrl: string
  requestId: string
  webhookId: string
}): Promise<SubscriptionResult> {
  const { apiKey, triggerId, viewId, notificationUrl, requestId, webhookId } = params

  if (!viewId) {
    logger.warn(`[${requestId}] Missing viewId for Grain webhook creation.`, {
      webhookId,
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
      { webhookId }
    )
  }

  logger.info(`[${requestId}] Creating legacy Grain v1 webhook`, {
    triggerId,
    viewId,
    actions,
    eventTypes,
    webhookId,
  })

  const requestBody: Record<string, unknown> = {
    version: 2,
    hook_url: notificationUrl,
    view_id: viewId,
  }
  if (actions.length > 0) {
    requestBody.actions = actions
  }

  const grainResponse = await fetch('https://api.grain.com/_/public-api/hooks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  const responseBody = (await grainResponse.json().catch(() => ({}))) as Record<string, unknown>

  if (!grainResponse.ok || responseBody.error || responseBody.errors) {
    const message = grainErrorMessage(responseBody)
    logger.error(
      `[${requestId}] Failed to create webhook in Grain for webhook ${webhookId}. Status: ${grainResponse.status}`,
      { message, response: responseBody }
    )
    throw new Error(grainUserFacingError(grainResponse.status, message))
  }

  const grainWebhookId = responseBody.id as string | undefined
  if (!grainWebhookId) {
    logger.error(
      `[${requestId}] Grain webhook creation response missing id for webhook ${webhookId}.`,
      { response: responseBody }
    )
    throw new Error(
      'Grain webhook created but no webhook ID was returned in the response. Cannot track subscription.'
    )
  }

  logger.info(`[${requestId}] Successfully created webhook in Grain for webhook ${webhookId}.`, {
    grainWebhookId,
    eventTypes,
  })

  return { providerConfigUpdates: { externalId: grainWebhookId, eventTypes } }
}

async function deleteLegacyV1Hook(params: {
  apiKey: string
  hookId: string
  requestId: string
}): Promise<void> {
  const response = await fetch(`https://api.grain.com/_/public-api/hooks/${params.hookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Failed to delete Grain webhook ${params.hookId}: ${response.status}`)
  }
}

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

  /**
   * Creates external subscriptions. Each v2 trigger maps to its hook types
   * (one v2 hook created per type; All Events owns one hook per type). Legacy
   * view-scoped triggers are NOT remapped — they keep calling the deprecated
   * v1 API unchanged until Grain sunsets it (2026-09-07), at which point their
   * deploys fail with Grain's own error and users must move to the v2
   * triggers.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined

      if (!apiKey) {
        logger.warn(`[${requestId}] Missing apiKey for Grain webhook creation.`, {
          webhookId: webhook.id,
        })
        throw new Error(
          'Grain API Key is required. Please provide your Grain access token in the trigger configuration.'
        )
      }

      const notificationUrl = getNotificationUrl(webhook)

      const v2HookTypes =
        GRAIN_V2_TRIGGER_TO_HOOK_TYPES[triggerId as keyof typeof GRAIN_V2_TRIGGER_TO_HOOK_TYPES]
      if (v2HookTypes) {
        const hookTypes = [...v2HookTypes]
        logger.info(`[${requestId}] Creating Grain v2 hooks`, {
          triggerId,
          hookTypes,
          webhookId: webhook.id,
        })

        const externalIds = await createGrainV2Hooks({
          apiKey,
          notificationUrl,
          hookTypes,
          requestId,
          webhookId: webhook.id as string,
        })

        logger.info(
          `[${requestId}] Successfully created ${externalIds.length} Grain hook(s) for webhook ${webhook.id}.`,
          { externalIds, hookTypes }
        )

        return {
          providerConfigUpdates: {
            externalIds,
            /** First id kept for backward-compatible single-id readers. */
            externalId: externalIds[0],
            eventTypes: hookTypes,
          },
        }
      }

      return createLegacyV1Subscription({
        apiKey,
        triggerId,
        viewId: providerConfig.viewId as string | undefined,
        notificationUrl,
        requestId,
        webhookId: webhook.id as string,
      })
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

  /**
   * Deletes every externally created hook. Rows created by the v2 path carry
   * `externalIds` (one per hook type) and delete through the v2 endpoint; rows
   * created before the migration carry a single `externalId` from the v1 API
   * and delete through the v1 endpoint they were created with.
   */
  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const isV2Row = Array.isArray(config.externalIds)
      const externalIds = (isV2Row ? (config.externalIds as string[]) : [config.externalId]).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )

      if (!apiKey) {
        logger.warn(
          `[${requestId}] Missing apiKey for Grain webhook deletion ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Grain apiKey for webhook deletion')
        return
      }

      if (externalIds.length === 0) {
        logger.warn(
          `[${requestId}] Missing externalId for Grain webhook deletion ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Grain externalId for webhook deletion')
        return
      }

      const failures: string[] = []
      for (const externalId of externalIds) {
        try {
          if (isV2Row) {
            await deleteGrainV2Hook({ apiKey, hookId: externalId, requestId })
          } else {
            await deleteLegacyV1Hook({ apiKey, hookId: externalId, requestId })
          }
          logger.info(`[${requestId}] Successfully deleted Grain webhook ${externalId}`)
        } catch (error) {
          logger.warn(`[${requestId}] Failed to delete Grain webhook ${externalId} (non-fatal)`, {
            error,
          })
          failures.push(externalId)
        }
      }

      if (failures.length > 0 && ctx.strict) {
        throw new Error(`Failed to delete ${failures.length} Grain webhook(s)`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Grain webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },
}
