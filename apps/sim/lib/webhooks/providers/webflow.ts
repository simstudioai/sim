import { createLogger } from '@sim/logger'
import type {
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Webflow')

export const webflowHandler: WebhookProviderHandler = {
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
