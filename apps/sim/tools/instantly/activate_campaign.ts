import type {
  InstantlyActivateCampaignParams,
  InstantlyCampaignActionResponse,
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

export const activateCampaignTool: ToolConfig<
  InstantlyActivateCampaignParams,
  InstantlyCampaignActionResponse
> = {
  id: 'instantly_activate_campaign',
  name: 'Instantly Activate Campaign',
  description: 'Activates, starts, or resumes an Instantly V2 campaign.',
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
    url: (params) => instantlyUrl(`/api/v2/campaigns/${params.campaignId.trim()}/activate`),
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
