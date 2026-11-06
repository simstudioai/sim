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
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

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
    const computedHash = hmacSha256Hex(body, secret)
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
        `Attio webhook ${webhook.id as string} has no signing secret, skipping signature verification`,
        { requestId }
      )
    } else {
      const signature = request.headers.get('Attio-Signature')

      if (!signature) {
        logger.warn('Attio webhook missing signature header', { requestId })
        return new NextResponse('Unauthorized - Missing Attio signature', {
          status: 401,
        })
      }

      const isValidSignature = validateAttioSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn('Attio signature verification failed', { requestId })
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
          `Attio event mismatch for trigger ${triggerId}. Event: ${eventType}. Skipping execution.`,
          {
            requestId,
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
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const config = getProviderConfig(webhookRecord)
      const { triggerId, credentialId } = config as {
        triggerId?: string
        credentialId?: string
      }

      if (!credentialId) {
        logger.warn('Missing credentialId for Attio webhook creation.', {
          requestId,
          webhookId: webhookRecord.id,
        })
        throw new WebhookDeploymentConfigurationError(
          'Attio account connection required. Please connect your Attio account in the trigger configuration and try again.'
        )
      }

      const accessToken = await getCredentialAccessToken(credentialId, requestId)

      if (!accessToken) {
        logger.warn(
          `Could not retrieve Attio access token for user ${userId}. Cannot create webhook.`,
          { requestId }
        )
        throw new Error(
          'Attio account connection required. Please connect your Attio account in the trigger configuration and try again.'
        )
      }

      const notificationUrl = getNotificationUrl(webhookRecord)

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
          logger.warn(`No event types mapped for trigger ${triggerId}`, {
            requestId,
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
          `Failed to create webhook in Attio for webhook ${webhookRecord.id}. Status: ${attioResponse.status}`,
          { requestId, response: errorBody }
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
          `Attio webhook created but no webhook_id returned for webhook ${webhookRecord.id}`,
          { requestId, response: responseBody }
        )
        throw new Error('Attio webhook creation succeeded but no webhook ID was returned')
      }

      if (!secret) {
        logger.warn(
          `Attio webhook created but no secret returned for webhook ${webhookRecord.id}. Signature verification will be skipped.`,
          { requestId, response: responseBody }
        )
      }

      logger.info(`Successfully created webhook in Attio for webhook ${webhookRecord.id}.`, {
        requestId,
        attioWebhookId: webhookId,
        targetUrl: notificationUrl,
        subscriptionCount: subscriptions.length,
        status: data.status,
      })

      return { providerConfigUpdates: { externalId: webhookId, webhookSecret: secret || '' } }
    } catch (error: unknown) {
      if (error instanceof WebhookDeploymentConfigurationError) throw error
      const message = toError(error).message
      logger.error(`Exception during Attio webhook creation for webhook ${webhookRecord.id}.`, {
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
          `Missing externalId for Attio webhook deletion ${webhookRecord.id}, skipping cleanup`,
          { requestId }
        )
        if (strict) throw new Error('Missing Attio externalId for webhook deletion')
        return
      }

      if (!credentialId) {
        logger.warn(
          `Missing credentialId for Attio webhook deletion ${webhookRecord.id}, skipping cleanup`,
          { requestId }
        )
        if (strict) throw new Error('Missing Attio credentialId for webhook deletion')
        return
      }

      const accessToken = await getCredentialAccessToken(credentialId, requestId)

      if (!accessToken) {
        const message = 'Could not retrieve Attio access token. Cannot delete webhook.'
        logger.warn(message, { requestId, webhookId: webhookRecord.id })
        if (strict) throw new Error(message)
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
        logger.warn(`Failed to delete Attio webhook (non-fatal): ${attioResponse.status}`, {
          requestId,
          response: responseBody,
        })
        if (strict) throw new Error(`Failed to delete Attio webhook: ${attioResponse.status}`)
      } else {
        logger.info(`Successfully deleted Attio webhook ${externalId}`, { requestId })
      }
    } catch (error) {
      logger.warn('Error deleting Attio webhook (non-fatal)', error, { requestId })
      if (strict) throw error
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
    const providerConfig = toRecord(webhook.providerConfig)
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
