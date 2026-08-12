import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { encodeWindchillOid, normalizeServiceRoot } from '@/tools/windchill/utils'
import {
  createWindchillSession,
  WindchillProviderError,
  windchillMutationRequest,
} from '@/tools/windchill/utils.server'

const logger = createLogger('WebhookProvider:Windchill')

function eventManagementRoot(baseUrl: string): string {
  return `${normalizeServiceRoot(baseUrl).replace(/\/v\d+$/i, '')}/EventMgmt`
}

function requiredString(config: Record<string, unknown>, key: string, label: string): string {
  const value = config[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

export const windchillHandler: WebhookProviderHandler = {
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult> {
    const config = getProviderConfig(ctx.webhook)
    const baseUrl = requiredString(config, 'triggerBaseUrl', 'Windchill service root')
    const username = requiredString(config, 'triggerUsername', 'Windchill username')
    const password = requiredString(config, 'triggerPassword', 'Windchill password')
    const triggerId = requiredString(config, 'triggerId', 'Windchill trigger ID')
    const scope = requiredString(config, 'triggerScope', 'Windchill subscription scope')
    if (scope !== 'document' && scope !== 'folder' && scope !== 'container') {
      throw new Error('Windchill subscription scope must be document, folder, or container')
    }

    const { resolveWindchillEventId } = await import('@/triggers/windchill/utils')
    const eventId = resolveWindchillEventId(
      triggerId,
      typeof config.triggerEvent === 'string' ? config.triggerEvent : undefined
    )
    const lifecycleState =
      triggerId === 'windchill_document_lifecycle_state_changed'
        ? requiredString(config, 'triggerLifecycleStateValue', 'Windchill lifecycle state value')
        : undefined
    if (lifecycleState && lifecycleState.length > 256) {
      throw new Error('Windchill lifecycle state value must be 256 characters or fewer')
    }

    const eventRoot = eventManagementRoot(baseUrl)
    const webhookId =
      typeof ctx.webhook.id === 'string' && ctx.webhook.id ? ctx.webhook.id : 'webhook'
    const requestBody: Record<string, unknown> = {
      Name: `Sim ${webhookId} ${eventId}`.slice(0, 200),
      CallbackURL: getNotificationUrl(ctx.webhook),
      'SubscribedEvent@odata.bind': `Events('${eventId}')`,
    }
    const subscriptionUrl = `${eventRoot}/EventSubscriptions`

    if (scope === 'document') {
      const documentOid = requiredString(config, 'triggerDocumentOid', 'Windchill document OID')
      requestBody['SubscribedOnEntity@odata.bind'] =
        `WindchillEntities('${encodeWindchillOid(documentOid)}')`
      requestBody.SubscribeAllVersions =
        config.triggerSubscribeAllVersions !== false &&
        config.triggerSubscribeAllVersions !== 'false'
      requestBody['@odata.type'] = 'PTC.EventMgmt.EntityEventSubscription'
    } else if (scope === 'folder') {
      const folderOid = requiredString(config, 'triggerFolderOid', 'Windchill folder OID')
      requestBody.SubscribedOnEntityType = 'PTC.DocMgmt.Document'
      requestBody['SubscribedOnFolder@odata.bind'] = `Folders('${encodeWindchillOid(folderOid)}')`
      requestBody['@odata.type'] = 'PTC.EventMgmt.EntityTypeInFolderEventSubscription'
    } else {
      const containerOid = requiredString(config, 'triggerContainerOid', 'Windchill container OID')
      requestBody.SubscribedOnEntityType = 'PTC.DocMgmt.Document'
      requestBody['SubscribedOnContext@odata.bind'] =
        `Containers('${encodeWindchillOid(containerOid)}')`
      requestBody['@odata.type'] = 'PTC.EventMgmt.EntityTypeInContainerEventSubscription'
    }

    if (lifecycleState) {
      requestBody.LifeCycleState = { Value: lifecycleState }
    }

    logger.info(`[${ctx.requestId}] Creating Windchill webhook subscription`, {
      webhookId,
      triggerId,
      eventId,
      scope,
    })

    const params = { baseUrl, username, password }
    const session = await createWindchillSession(params)
    const response = await windchillMutationRequest({
      params,
      session,
      url: subscriptionUrl,
      method: 'POST',
      body: requestBody,
    })
    const externalId = isRecordLike(response) ? response.ID : undefined
    if (typeof externalId !== 'string' || !externalId.trim()) {
      throw new Error('Windchill subscription was created but no subscription ID was returned')
    }

    logger.info(
      `[${ctx.requestId}] Created Windchill webhook subscription ${externalId} for webhook ${webhookId}`
    )
    return { providerConfigUpdates: { externalId } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)

    try {
      const baseUrl = requiredString(config, 'triggerBaseUrl', 'Windchill service root')
      const username = requiredString(config, 'triggerUsername', 'Windchill username')
      const password = requiredString(config, 'triggerPassword', 'Windchill password')
      const externalId = requiredString(config, 'externalId', 'Windchill subscription ID')
      const params = { baseUrl, username, password }
      const session = await createWindchillSession(params)

      await windchillMutationRequest({
        params,
        session,
        url: `${eventManagementRoot(baseUrl)}/EventSubscriptions('${encodeWindchillOid(externalId)}')`,
        method: 'DELETE',
      })
      logger.info(
        `[${ctx.requestId}] Deleted Windchill webhook subscription ${externalId} for webhook ${ctx.webhook.id}`
      )
    } catch (error) {
      if (error instanceof WindchillProviderError && error.status === 404) {
        logger.info(
          `[${ctx.requestId}] Windchill webhook subscription was already deleted for webhook ${ctx.webhook.id}`
        )
        return
      }

      logger.warn(
        `[${ctx.requestId}] Failed to delete Windchill webhook subscription for webhook ${ctx.webhook.id} (non-fatal)`,
        { message: getErrorMessage(error, 'unknown error') }
      )
      if (ctx.strict) throw error
    }
  },
}
