import type {
  InstantlyCampaignActionResponse,
  InstantlyPauseCampaignParams,
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

export const pauseCampaignTool: ToolConfig<
  InstantlyPauseCampaignParams,
  InstantlyCampaignActionResponse
> = {
  id: 'instantly_pause_campaign',
  name: 'Instantly Pause Campaign',
  description: 'Pauses a running Instantly V2 campaign, stopping further email sends.',
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
    url: (params) => instantlyUrl(`/api/v2/campaigns/${params.campaignId.trim()}/pause`),
    method: 'POST',
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
