import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface DeleteCampaignWebhookParams extends SmartleadCampaignIdParams {
  webhookId: number
}

export const deleteCampaignWebhookTool: ToolConfig<
  DeleteCampaignWebhookParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_delete_campaign_webhook',
  name: 'Smartlead Delete Campaign Webhook',
  description: 'Deletes a webhook from a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    webhookId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the webhook to delete, from List Campaign Webhooks',
    },
  },
  request: {
    // Smartlead takes the webhook id in the body here, not the path.
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/webhooks`, params.apiKey),
    method: 'DELETE',
    headers: smartleadHeaders,
    body: (params) => ({ id: params.webhookId }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'webhook delete')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
