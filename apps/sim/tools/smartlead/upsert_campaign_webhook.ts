import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadUpsertWebhookResponse,
} from '@/tools/smartlead/types'
import {
  mapSavedWebhook,
  pathSegment,
  type SMARTLEAD_WEBHOOK_EVENT_TYPES,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
  upsertWebhookOutputs,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface UpsertCampaignWebhookParams extends SmartleadCampaignIdParams {
  name: string
  webhookUrl: string
  eventTypes: (typeof SMARTLEAD_WEBHOOK_EVENT_TYPES)[number][]
  categories: string[]
  webhookId?: number
}

export const upsertCampaignWebhookTool: ToolConfig<
  UpsertCampaignWebhookParams,
  SmartleadUpsertWebhookResponse
> = {
  id: 'smartlead_upsert_campaign_webhook',
  name: 'Smartlead Create or Update Campaign Webhook',
  description:
    'Creates a webhook on a Smartlead campaign, or updates an existing one when a webhook ID is supplied. Smartlead requires at least one lead category.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Webhook name',
    },
    webhookUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'HTTPS URL Smartlead should post events to',
    },
    eventTypes: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Events to subscribe to. Allowed values: EMAIL_SENT, EMAIL_OPEN, EMAIL_LINK_CLICK, EMAIL_REPLY, EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, LEAD_CATEGORY_UPDATED',
      items: { type: 'string' },
    },
    categories: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Lead category names the webhook applies to, e.g. Interested. Smartlead rejects an empty list.',
      items: { type: 'string' },
    },
    webhookId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing webhook ID to update; omit to create a new webhook',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/webhooks`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) => ({
      id: params.webhookId ?? null,
      name: params.name,
      webhook_url: params.webhookUrl,
      event_types: Array.isArray(params.eventTypes) ? params.eventTypes : [],
      categories: Array.isArray(params.categories) ? params.categories : [],
    }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'webhook')

    return {
      success: true,
      output: mapSavedWebhook(record),
    }
  },
  outputs: upsertWebhookOutputs,
}
