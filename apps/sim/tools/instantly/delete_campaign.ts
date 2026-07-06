import type {
  InstantlyCampaignActionResponse,
  InstantlyDeleteCampaignParams,
} from '@/tools/instantly/types'
import {
  campaignActionOutputs,
  getMessage,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  mapCampaign,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteCampaignTool: ToolConfig<
  InstantlyDeleteCampaignParams,
  InstantlyCampaignActionResponse
> = {
  id: 'instantly_delete_campaign',
  name: 'Instantly Delete Campaign',
  description: 'Permanently deletes an Instantly V2 campaign.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign ID',
    },
  },
  request: {
    url: (params) => instantlyUrl(`/api/v2/campaigns/${params.campaignId.trim()}`),
    method: 'DELETE',
    headers: instantlyHeaders,
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const campaign = mapCampaign(data)

    return {
      success: true,
      output: {
        campaign,
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        message: getMessage(data),
      },
    }
  },
  outputs: campaignActionOutputs,
}
