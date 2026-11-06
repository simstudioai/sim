import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toError } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import {
  getCredentialAccessToken,
  getNotificationUrl,
  getProviderConfig,
} from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
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
import { CLICKUP_API_BASE_URL, clickupAuthorizationHeader } from '@/tools/clickup/shared'

const logger = createLogger('WebhookProvider:ClickUp')

function validateClickUpSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }
    const computedHash = hmacSha256Hex(body, secret)
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating ClickUp signature:', error)
    return false
  }
}

/**
 * Resolves the OAuth access token for the credential stored in the webhook's
 * provider config. Throws a user-facing error when the credential is missing
 * or the token cannot be retrieved.
 */
async function resolveClickUpAccessToken(
  credentialId: string | undefined,
  requestId: string
): Promise<string> {
  if (!credentialId) {
    throw new WebhookDeploymentConfigurationError(
      'ClickUp account connection required. Please connect your ClickUp account in the trigger configuration and try again.'
    )
  }

  const accessToken = await getCredentialAccessToken(credentialId, requestId)

  if (!accessToken) {
    throw new Error(
      'ClickUp account connection required. Please connect your ClickUp account in the trigger configuration and try again.'
    )
  }

  return accessToken
}

/**
 * Parses an optional numeric location filter (space, folder, list). ClickUp
 * expects these as integers in the create-webhook body.
 */
function parseOptionalNumericId(value: unknown, label: string): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new WebhookDeploymentConfigurationError(
      `ClickUp ${label} must be a whole number. Received: ${raw}`
    )
  }
  return parsed
}

function parseOptionalStringId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  return raw || undefined
}

async function deleteClickUpWebhook(accessToken: string, externalId: string): Promise<Response> {
  return fetch(`${CLICKUP_API_BASE_URL}/webhook/${externalId}`, {
    method: 'DELETE',
    headers: { Authorization: clickupAuthorizationHeader(accessToken) },
  })
}

export const clickupHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Signature',
    validateFn: validateClickUpSignature,
    providerLabel: 'ClickUp',
    requireSecret: true,
  }),

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'clickup_webhook') {
      const { isClickUpEventMatch, getClickUpEventType } = await import('@/triggers/clickup/utils')
      if (!isClickUpEventMatch(triggerId, obj)) {
        logger.debug(
          `ClickUp event mismatch for trigger ${triggerId}. Event: ${getClickUpEventType(obj)}. Skipping execution.`,
          { requestId, webhookId: webhook.id, workflowId: workflow.id, triggerId }
        )
        return NextResponse.json({
          status: 'skipped',
          reason: 'event_type_mismatch',
        })
      }
    }

    return true
  },

  /**
   * ClickUp documents `{{webhook_id}}:{{history_item_id}}` as the recommended
   * idempotency key; history item IDs are unique per delivered event.
   */
  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    const webhookId = obj.webhook_id
    if (typeof webhookId !== 'string' || !webhookId) return null

    const historyItems = Array.isArray(obj.history_items) ? obj.history_items : []
    const firstItem = historyItems[0] as Record<string, unknown> | undefined
    const historyId = firstItem?.id
    if (!historyId) return null

    return `clickup:${webhookId}:${historyId}`
  },

  async createSubscription({
    webhook: webhookRecord,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const config = getProviderConfig(webhookRecord)
      const triggerId = config.triggerId as string | undefined
      const credentialId = config.credentialId as string | undefined

      const accessToken = await resolveClickUpAccessToken(credentialId, requestId)

      const workspaceId = parseOptionalStringId(config.triggerWorkspaceId)
      if (!workspaceId) {
        throw new WebhookDeploymentConfigurationError(
          'ClickUp workspace is required. Please select a workspace in the trigger configuration and try again.'
        )
      }

      let events: string[]
      if (triggerId === 'clickup_webhook') {
        events = ['*']
      } else {
        const { CLICKUP_TRIGGER_EVENT_MAP } = await import('@/triggers/clickup/utils')
        const mappedEvents = CLICKUP_TRIGGER_EVENT_MAP[triggerId as string]
        if (!mappedEvents || mappedEvents.length === 0) {
          throw new Error(`Unknown ClickUp trigger type: ${triggerId}`)
        }
        events = mappedEvents
      }

      const requestBody: Record<string, unknown> = {
        endpoint: getNotificationUrl(webhookRecord),
        events,
      }

      const spaceId = parseOptionalNumericId(config.triggerSpaceId, 'Space ID')
      const folderId = parseOptionalNumericId(config.triggerFolderId, 'Folder ID')
      const listId = parseOptionalNumericId(config.triggerListId, 'List ID')
      const taskId = parseOptionalStringId(config.triggerTaskId)
      if (spaceId !== undefined) requestBody.space_id = spaceId
      if (folderId !== undefined) requestBody.folder_id = folderId
      if (listId !== undefined) requestBody.list_id = listId
      if (taskId !== undefined) requestBody.task_id = taskId

      const clickupResponse = await fetch(
        `${CLICKUP_API_BASE_URL}/team/${encodeURIComponent(workspaceId)}/webhook`,
        {
          method: 'POST',
          headers: {
            Authorization: clickupAuthorizationHeader(accessToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      )

      if (!clickupResponse.ok) {
        const errorBody = (await clickupResponse.json().catch(() => ({}))) as { err?: string }
        logger.error(
          `Failed to create webhook in ClickUp for webhook ${webhookRecord.id}. Status: ${clickupResponse.status}`,
          { requestId, response: errorBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in ClickUp'
        if (clickupResponse.status === 401) {
          userFriendlyMessage =
            'ClickUp authentication failed. Please reconnect your ClickUp account.'
        } else if (clickupResponse.status === 403) {
          userFriendlyMessage =
            'ClickUp access denied. Please ensure your account can manage webhooks in this workspace.'
        } else if (errorBody.err) {
          userFriendlyMessage = `Failed to create webhook subscription in ClickUp: ${errorBody.err}`
        }

        throw new Error(userFriendlyMessage)
      }

      const responseBody = (await clickupResponse.json().catch(() => ({}))) as {
        id?: string
        webhook?: { id?: string; secret?: string }
      }
      const externalId = responseBody.id ?? responseBody.webhook?.id
      const secret = responseBody.webhook?.secret
      const redactedResponse = {
        ...responseBody,
        webhook: responseBody.webhook
          ? {
              ...responseBody.webhook,
              secret: responseBody.webhook.secret ? '[redacted]' : undefined,
            }
          : undefined,
      }

      if (!externalId) {
        logger.error(
          `ClickUp webhook created but no webhook id returned for webhook ${webhookRecord.id}`,
          { requestId, response: redactedResponse }
        )
        throw new Error('ClickUp webhook creation succeeded but no webhook ID was returned')
      }

      if (!secret) {
        logger.error(
          `ClickUp webhook created but no secret returned for webhook ${webhookRecord.id}. Rolling back.`,
          { requestId, response: redactedResponse }
        )
        const rollback = await deleteClickUpWebhook(accessToken, externalId).catch(() => undefined)
        if (!rollback || (!rollback.ok && rollback.status !== 404)) {
          logger.error(`Failed to roll back ClickUp webhook ${externalId} after missing secret`, {
            requestId,
            clickupWebhookId: externalId,
            status: rollback?.status,
          })
          throw new Error(
            `ClickUp webhook creation succeeded but no signing secret was returned, and rolling back the webhook failed. Delete webhook ${externalId} manually in ClickUp before retrying.`
          )
        }
        throw new Error('ClickUp webhook creation succeeded but no signing secret was returned')
      }

      logger.info(`Successfully created webhook in ClickUp for webhook ${webhookRecord.id}.`, {
        requestId,
        clickupWebhookId: externalId,
        workspaceId,
        events,
      })

      return { providerConfigUpdates: { externalId, webhookSecret: secret } }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const message = toError(error).message
      logger.error(`Exception during ClickUp webhook creation for webhook ${webhookRecord.id}.`, {
        requestId,
        message,
      })
      throw error
    }
  },

  async deleteSubscription({
    webhook: webhookRecord,
    requestId,
    strict,
  }: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(webhookRecord)
      const externalId = config.externalId as string | undefined
      const credentialId = config.credentialId as string | undefined

      if (!externalId) {
        logger.warn(
          `Missing externalId for ClickUp webhook deletion ${webhookRecord.id}, skipping cleanup`,
          { requestId }
        )
        if (strict) throw new Error('Missing ClickUp externalId for webhook deletion')
        return
      }

      if (!credentialId) {
        logger.warn(
          `Missing credentialId for ClickUp webhook deletion ${webhookRecord.id}, skipping cleanup`,
          { requestId }
        )
        if (strict) throw new Error('Missing ClickUp credentialId for webhook deletion')
        return
      }

      const accessToken = await getCredentialAccessToken(credentialId, requestId)

      if (!accessToken) {
        const message = 'Could not retrieve ClickUp access token. Cannot delete webhook.'
        logger.warn(message, { requestId, webhookId: webhookRecord.id })
        if (strict) throw new Error(message)
        return
      }

      const clickupResponse = await deleteClickUpWebhook(accessToken, externalId)

      if (!clickupResponse.ok && clickupResponse.status !== 404) {
        const responseBody = await clickupResponse.json().catch(() => ({}))
        logger.warn(`Failed to delete ClickUp webhook (non-fatal): ${clickupResponse.status}`, {
          requestId,
          response: responseBody,
        })
        if (strict) throw new Error(`Failed to delete ClickUp webhook: ${clickupResponse.status}`)
      } else {
        logger.info(`Successfully deleted ClickUp webhook ${externalId}`, { requestId })
      }
    } catch (error) {
      logger.warn('Error deleting ClickUp webhook (non-fatal)', error, { requestId })
      if (strict) throw error
    }
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const {
      extractClickUpTaskData,
      extractClickUpListData,
      extractClickUpFolderData,
      extractClickUpSpaceData,
      extractClickUpGoalData,
      extractClickUpGenericData,
    } = await import('@/triggers/clickup/utils')

    const b = body as Record<string, unknown>
    const providerConfig = toRecord(webhook.providerConfig)
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId?.startsWith('clickup_task_')) {
      return { input: extractClickUpTaskData(b) }
    }
    if (triggerId?.startsWith('clickup_list_')) {
      return { input: extractClickUpListData(b) }
    }
    if (triggerId?.startsWith('clickup_folder_')) {
      return { input: extractClickUpFolderData(b) }
    }
    if (triggerId?.startsWith('clickup_space_')) {
      return { input: extractClickUpSpaceData(b) }
    }
    if (triggerId?.startsWith('clickup_goal_') || triggerId?.startsWith('clickup_key_result_')) {
      return { input: extractClickUpGoalData(b) }
    }
    return { input: extractClickUpGenericData(b) }
  },
}
