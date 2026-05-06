import type {
  EmailBisonCampaignResponse,
  EmailBisonCreateCampaignParams,
} from '@/tools/emailbison/types'
import {
  campaignOutputs,
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  jsonBody,
  mapCampaign,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const createCampaignTool: ToolConfig<
  EmailBisonCreateCampaignParams,
  EmailBisonCampaignResponse
> = {
  id: 'emailbison_create_campaign',
  name: 'Email Bison Create Campaign',
  description: 'Creates a new Email Bison campaign.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign name',
    },
    campaignType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign type: outbound or reply_followup',
    },
  },
  request: {
    url: (params) => emailBisonUrl('/api/campaigns', {}, params.apiBaseUrl),
    method: 'POST',
    headers: emailBisonHeaders,
    body: (params) =>
      jsonBody({
        name: params.name,
        type: params.campaignType,
      }),
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'campaign')

    return {
      success: true,
      output: mapCampaign(data),
    }
  },
  outputs: campaignOutputs,
}
