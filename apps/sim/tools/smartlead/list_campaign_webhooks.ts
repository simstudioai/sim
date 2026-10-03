import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadListWebhooksResponse,
} from '@/tools/smartlead/types'
import {
  listWebhooksOutputs,
  mapWebhook,
  pathSegment,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const listCampaignWebhooksTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadListWebhooksResponse
> = {
  id: 'smartlead_list_campaign_webhooks',
  name: 'Smartlead List Campaign Webhooks',
  description: 'Retrieves the webhooks registered on a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/webhooks`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const data = await smartleadArray(response, 'webhooks')
    const webhooks = data.map(mapWebhook)

    return {
      success: true,
      output: {
        webhooks,
        count: webhooks.length,
      },
    }
  },
  outputs: listWebhooksOutputs,
}
