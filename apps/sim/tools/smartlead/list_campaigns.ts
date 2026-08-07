import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadListCampaignsResponse } from '@/tools/smartlead/types'
import {
  listCampaignsOutputs,
  mapCampaign,
  smartleadArray,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface ListCampaignsParams extends SmartleadBaseParams {
  clientId?: number
  includeTags?: boolean
}

export const listCampaignsTool: ToolConfig<ListCampaignsParams, SmartleadListCampaignsResponse> = {
  id: 'smartlead_list_campaigns',
  name: 'Smartlead List Campaigns',
  description: 'Retrieves all Smartlead campaigns for the authenticated account.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    clientId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return campaigns for this client (agency accounts)',
    },
    includeTags: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include campaign tags in the response',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl('/campaigns/', params.apiKey, {
        client_id: params.clientId,
        include_tags: params.includeTags,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const data = await smartleadArray(response, 'campaigns')
    const campaigns = data.map(mapCampaign)

    return {
      success: true,
      output: {
        campaigns,
        count: campaigns.length,
      },
    }
  },
  outputs: listCampaignsOutputs,
}
