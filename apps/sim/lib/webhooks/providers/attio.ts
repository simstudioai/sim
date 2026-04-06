import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getCredentialOwner, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
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
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Attio')

function validateAttioSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Attio signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Attio signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Attio signature:', error)
    return false
  }
}

export const attioHandler: WebhookProviderHandler = {
  verifyAuth({ webhook, request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined

    if (!secret) {
      logger.debug(
        `[${requestId}] Attio webhook ${webhook.id as string} has no signing secret, skipping signature verification`
      )
    } else {
      const signature = request.headers.get('Attio-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Attio webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Attio signature', {
          status: 401,
        })
      }

      const isValidSignature = validateAttioSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Attio signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Attio signature', {
          status: 401,
        })
      }
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'attio_webhook') {
      const { isAttioPayloadMatch, getAttioEvent } = await import('@/triggers/attio/utils')
      if (!isAttioPayloadMatch(triggerId, obj)) {
        const event = getAttioEvent(obj)
        const eventType = event?.event_type as string | undefined
        logger.debug(
          `[${requestId}] Attio event mismatch for trigger ${triggerId}. Event: ${eventType}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: eventType,
            bodyKeys: Object.keys(obj),
          }
        )
        return NextResponse.json({
          status: 'skipped',
          reason: 'event_type_mismatch',
        })
      }
    }

    return true
  },

  async createSubscription({
    webhook: webhookRecord,
    workflow,
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const { path, providerConfig } = webhookRecord as Record<string, unknown>
      const config = (providerConfig as Record<string, unknown>) || {}
      const { triggerId, credentialId } = config as {
        triggerId?: string
        credentialId?: string
      }

      if (!credentialId) {
        logger.warn(`[${requestId}] Missing credentialId for Attio webhook creation.`, {
          webhookId: webhookRecord.id,
        })
        throw new Error(
          'Attio account connection required. Please connect your Attio account in the trigger configuration and try again.'
        )
      }

      const credentialOwner = await getCredentialOwner(credentialId, requestId)
      const accessToken = credentialOwner
        ? await refreshAccessTokenIfNeeded(
            credentialOwner.accountId,
            credentialOwner.userId,
            requestId
          )
        : null

      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not retrieve Attio access token for user ${userId}. Cannot create webhook.`
        )
        throw new Error(
          'Attio account connection required. Please connect your Attio account in the trigger configuration and try again.'
        )
      }

      const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

      const { TRIGGER_EVENT_MAP } = await import('@/triggers/attio/utils')

      let subscriptions: Array<{ event_type: string; filter: null }> = []
      if (triggerId === 'attio_webhook') {
        const allEvents = new Set<string>()
        for (const events of Object.values(TRIGGER_EVENT_MAP)) {
          for (const event of events) {
            allEvents.add(event)
          }
        }
        subscriptions = Array.from(allEvents).map((event_type) => ({ event_type, filter: null }))
      } else {
        const events = TRIGGER_EVENT_MAP[triggerId as string]
        if (!events || events.length === 0) {
          logger.warn(`[${requestId}] No event types mapped for trigger ${triggerId}`, {
            webhookId: webhookRecord.id,
          })
          throw new Error(`Unknown Attio trigger type: ${triggerId}`)
        }
        subscriptions = events.map((event_type) => ({ event_type, filter: null }))
      }

      const requestBody = {
        data: {
          target_url: notificationUrl,
          subscriptions,
        },
      }

      const attioResponse = await fetch('https://api.attio.com/v2/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!attioResponse.ok) {
        const errorBody = await attioResponse.json().catch(() => ({}))
        logger.error(
          `[${requestId}] Failed to create webhook in Attio for webhook ${webhookRecord.id}. Status: ${attioResponse.status}`,
          { response: errorBody }
        )

        let userFriendlyMessage = 'Failed to create webhook subscription in Attio'
        if (attioResponse.status === 401) {
          userFriendlyMessage = 'Attio authentication failed. Please reconnect your Attio account.'
        } else if (attioResponse.status === 403) {
          userFriendlyMessage =
            'Attio access denied. Please ensure your integration has webhook permissions.'
        }

        throw new Error(userFriendlyMessage)
      }

      const responseBody = await attioResponse.json()
      const data = responseBody.data || responseBody
      const webhookId = data.id?.webhook_id || data.webhook_id || data.id
      const secret = data.secret

      if (!webhookId) {
        logger.error(
          `[${requestId}] Attio webhook created but no webhook_id returned for webhook ${webhookRecord.id}`,
          { response: responseBody }
        )
        throw new Error('Attio webhook creation succeeded but no webhook ID was returned')
      }

      if (!secret) {
        logger.warn(
          `[${requestId}] Attio webhook created but no secret returned for webhook ${webhookRecord.id}. Signature verification will be skipped.`,
          { response: responseBody }
        )
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Attio for webhook ${webhookRecord.id}.`,
        {
          attioWebhookId: webhookId,
          targetUrl: notificationUrl,
          subscriptionCount: subscriptions.length,
          status: data.status,
        }
      )

      return { providerConfigUpdates: { externalId: webhookId, webhookSecret: secret || '' } }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[${requestId}] Exception during Attio webhook creation for webhook ${webhookRecord.id}.`,
        { message }
      )
      throw error
    }
  },

  async deleteSubscription({
    webhook: webhookRecord,
    workflow,
    requestId,
  }: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(webhookRecord)
      const externalId = config.externalId as string | undefined
      const credentialId = config.credentialId as string | undefined

      if (!externalId) {
        logger.warn(
          `[${requestId}] Missing externalId for Attio webhook deletion ${webhookRecord.id}, skipping cleanup`
        )
        return
      }

      if (!credentialId) {
        logger.warn(
          `[${requestId}] Missing credentialId for Attio webhook deletion ${webhookRecord.id}, skipping cleanup`
        )
        return
      }

      const credentialOwner = await getCredentialOwner(credentialId, requestId)
      const accessToken = credentialOwner
        ? await refreshAccessTokenIfNeeded(
            credentialOwner.accountId,
            credentialOwner.userId,
            requestId
          )
        : null

      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not retrieve Attio access token. Cannot delete webhook.`,
          { webhookId: webhookRecord.id }
        )
        return
      }

      const attioResponse = await fetch(`https://api.attio.com/v2/webhooks/${externalId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!attioResponse.ok && attioResponse.status !== 404) {
        const responseBody = await attioResponse.json().catch(() => ({}))
        logger.warn(
          `[${requestId}] Failed to delete Attio webhook (non-fatal): ${attioResponse.status}`,
          { response: responseBody }
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Attio webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Attio webhook (non-fatal)`, error)
    }
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const {
      extractAttioRecordData,
      extractAttioRecordUpdatedData,
      extractAttioRecordMergedData,
      extractAttioNoteData,
      extractAttioTaskData,
      extractAttioCommentData,
      extractAttioListEntryData,
      extractAttioListEntryUpdatedData,
      extractAttioListData,
      extractAttioWorkspaceMemberData,
      extractAttioGenericData,
    } = await import('@/triggers/attio/utils')

    const b = body as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'attio_record_updated') {
      return { input: extractAttioRecordUpdatedData(b) }
    }
    if (triggerId === 'attio_record_merged') {
      return { input: extractAttioRecordMergedData(b) }
    }
    if (triggerId === 'attio_record_created' || triggerId === 'attio_record_deleted') {
      return { input: extractAttioRecordData(b) }
    }
    if (triggerId?.startsWith('attio_note_')) {
      return { input: extractAttioNoteData(b) }
    }
    if (triggerId?.startsWith('attio_task_')) {
      return { input: extractAttioTaskData(b) }
    }
    if (triggerId?.startsWith('attio_comment_')) {
      return { input: extractAttioCommentData(b) }
    }
    if (triggerId === 'attio_list_entry_updated') {
      return { input: extractAttioListEntryUpdatedData(b) }
    }
    if (triggerId === 'attio_list_entry_created' || triggerId === 'attio_list_entry_deleted') {
      return { input: extractAttioListEntryData(b) }
    }
    if (
      triggerId === 'attio_list_created' ||
      triggerId === 'attio_list_updated' ||
      triggerId === 'attio_list_deleted'
    ) {
      return { input: extractAttioListData(b) }
    }
    if (triggerId === 'attio_workspace_member_created') {
      return { input: extractAttioWorkspaceMemberData(b) }
    }
    return { input: extractAttioGenericData(b) }
  },
}
