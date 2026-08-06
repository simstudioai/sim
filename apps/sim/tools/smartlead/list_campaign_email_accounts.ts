import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadOpaqueListResponse,
} from '@/tools/smartlead/types'
import {
  opaqueListOutputs,
  pathSegment,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

export const listCampaignEmailAccountsTool: ToolConfig<
  SmartleadCampaignIdParams,
  SmartleadOpaqueListResponse
> = {
  id: 'smartlead_list_campaign_email_accounts',
  name: 'Smartlead List Campaign Email Accounts',
  description: 'Retrieves the sending email accounts attached to a Smartlead campaign.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/email-accounts`, params.apiKey),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const items = await smartleadArray(response, 'campaign email accounts')

    return {
      success: true,
      output: { items, count: items.length },
    }
  },
  outputs: opaqueListOutputs,
}
