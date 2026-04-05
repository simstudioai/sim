import { createLogger } from '@sim/logger'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getCredentialOwner, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Webflow')

export const webflowHandler: WebhookProviderHandler = {
  async createSubscription({
    webhook: webhookRecord,
    workflow,
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const { path, providerConfig } = webhookRecord as Record<string, unknown>
      const config = (providerConfig as Record<string, unknown>) || {}
      const { siteId, triggerId, collectionId, formName, credentialId } = config as {
        siteId?: string
        triggerId?: string
        collectionId?: string
        formName?: string
        credentialId?: string
      }

      if (!siteId) {
        logger.warn(`[${requestId}] Missing siteId for Webflow webhook creation.`, {
          webhookId: webhookRecord.id,
        })
        throw new Error('Site ID is required to create Webflow webhook')
      }

      const siteIdValidation = validateAlphanumericId(siteId, 'siteId', 100)
      if (!siteIdValidation.isValid) {
        throw new Error(siteIdValidation.error)
      }

      if (!triggerId) {
        logger.warn(`[${requestId}] Missing triggerId for Webflow webhook creation.`, {
          webhookId: webhookRecord.id,
        })
        throw new Error('Trigger type is required to create Webflow webhook')
      }

      const credentialOwner = credentialId
        ? await getCredentialOwner(credentialId, requestId)
        : null
      const accessToken = credentialId
        ? credentialOwner
          ? await refreshAccessTokenIfNeeded(
              credentialOwner.accountId,
              credentialOwner.userId,
              requestId
            )
          : null
        : await getOAuthToken(userId, 'webflow')
      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not retrieve Webflow access token for user ${userId}. Cannot create webhook in Webflow.`
        )
        throw new Error(
          'Webflow account connection required. Please connect your Webflow account in the trigger configuration and try again.'
        )
      }

      const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

      const triggerTypeMap: Record<string, string> = {
        webflow_collection_item_created: 'collection_item_created',
        webflow_collection_item_changed: 'collection_item_changed',
        webflow_collection_item_deleted: 'collection_item_deleted',
        webflow_form_submission: 'form_submission',
      }

      const webflowTriggerType = triggerTypeMap[triggerId]
      if (!webflowTriggerType) {
        logger.warn(`[${requestId}] Invalid triggerId for Webflow: ${triggerId}`, {
          webhookId: webhookRecord.id,
        })
        throw new Error(`Invalid Webflow trigger type: ${triggerId}`)
      }

      const webflowApiUrl = `https://api.webflow.com/v2/sites/${siteId}/webhooks`

      const requestBody: Record<string, unknown> = {
        triggerType: webflowTriggerType,
        url: notificationUrl,
      }

      if (formName && webflowTriggerType === 'form_submission') {
        requestBody.filter = {
          name: formName,
        }
      }

      const webflowResponse = await fetch(webflowApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = await webflowResponse.json()

      if (!webflowResponse.ok || responseBody.error) {
        const errorMessage =
          responseBody.message || responseBody.error || 'Unknown Webflow API error'
        logger.error(
          `[${requestId}] Failed to create webhook in Webflow for webhook ${webhookRecord.id}. Status: ${webflowResponse.status}`,
          { message: errorMessage, response: responseBody }
        )
        throw new Error(errorMessage)
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Webflow for webhook ${webhookRecord.id}.`,
        {
          webflowWebhookId: responseBody.id || responseBody._id,
        }
      )

      return { providerConfigUpdates: { externalId: responseBody.id || responseBody._id } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Webflow webhook creation for webhook ${webhookRecord.id}.`,
        {
          message: err.message,
          stack: err.stack,
        }
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
      const siteId = config.siteId as string | undefined
      const externalId = config.externalId as string | undefined

      if (!siteId) {
        logger.warn(
          `[${requestId}] Missing siteId for Webflow webhook deletion ${webhookRecord.id}, skipping cleanup`
        )
        return
      }

      if (!externalId) {
        logger.warn(
          `[${requestId}] Missing externalId for Webflow webhook deletion ${webhookRecord.id}, skipping cleanup`
        )
        return
      }

      const siteIdValidation = validateAlphanumericId(siteId, 'siteId', 100)
      if (!siteIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid Webflow site ID format, skipping deletion`, {
          webhookId: webhookRecord.id,
          siteId: siteId.substring(0, 30),
        })
        return
      }

      const webhookIdValidation = validateAlphanumericId(externalId, 'webhookId', 100)
      if (!webhookIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid Webflow webhook ID format, skipping deletion`, {
          webhookId: webhookRecord.id,
          externalId: externalId.substring(0, 30),
        })
        return
      }

      const credentialId = config.credentialId as string | undefined
      if (!credentialId) {
        logger.warn(
          `[${requestId}] Missing credentialId for Webflow webhook deletion ${webhookRecord.id}`
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
          `[${requestId}] Could not retrieve Webflow access token. Cannot delete webhook.`,
          { webhookId: webhookRecord.id }
        )
        return
      }

      const webflowApiUrl = `https://api.webflow.com/v2/sites/${siteId}/webhooks/${externalId}`

      const webflowResponse = await fetch(webflowApiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      })

      if (!webflowResponse.ok && webflowResponse.status !== 404) {
        const responseBody = await webflowResponse.json().catch(() => ({}))
        logger.warn(
          `[${requestId}] Failed to delete Webflow webhook (non-fatal): ${webflowResponse.status}`,
          { response: responseBody }
        )
      } else {
        logger.info(`[${requestId}] Successfully deleted Webflow webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Webflow webhook (non-fatal)`, error)
    }
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId === 'webflow_form_submission') {
      return {
        input: {
          siteId: b?.siteId || '',
          formId: b?.formId || '',
          name: b?.name || '',
          id: b?.id || '',
          submittedAt: b?.submittedAt || '',
          data: b?.data || {},
          schema: b?.schema || {},
          formElementId: b?.formElementId || '',
        },
      }
    }
    const { _cid, _id, ...itemFields } = b || ({} as Record<string, unknown>)
    return {
      input: {
        siteId: b?.siteId || '',
        collectionId: (_cid || b?.collectionId || '') as string,
        payload: {
          id: (_id || '') as string,
          cmsLocaleId: (itemFields as Record<string, unknown>)?.cmsLocaleId || '',
          lastPublished:
            (itemFields as Record<string, unknown>)?.lastPublished ||
            (itemFields as Record<string, unknown>)?.['last-published'] ||
            '',
          lastUpdated:
            (itemFields as Record<string, unknown>)?.lastUpdated ||
            (itemFields as Record<string, unknown>)?.['last-updated'] ||
            '',
          createdOn:
            (itemFields as Record<string, unknown>)?.createdOn ||
            (itemFields as Record<string, unknown>)?.['created-on'] ||
            '',
          isArchived:
            (itemFields as Record<string, unknown>)?.isArchived ||
            (itemFields as Record<string, unknown>)?._archived ||
            false,
          isDraft:
            (itemFields as Record<string, unknown>)?.isDraft ||
            (itemFields as Record<string, unknown>)?._draft ||
            false,
          fieldData: itemFields,
        },
      },
    }
  },

  shouldSkipEvent({ webhook, body, requestId, providerConfig }: EventFilterContext) {
    const configuredCollectionId = providerConfig.collectionId as string | undefined
    if (configuredCollectionId) {
      const obj = body as Record<string, unknown>
      const payload = obj.payload as Record<string, unknown> | undefined
      const payloadCollectionId = (payload?.collectionId ?? obj.collectionId) as string | undefined

      if (payloadCollectionId && payloadCollectionId !== configuredCollectionId) {
        logger.info(
          `[${requestId}] Webflow collection '${payloadCollectionId}' doesn't match configured collection '${configuredCollectionId}' for webhook ${webhook.id as string}, skipping`
        )
        return true
      }
    }
    return false
  },
}
