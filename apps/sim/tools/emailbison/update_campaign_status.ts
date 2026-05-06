import type {
  EmailBisonCampaignResponse,
  EmailBisonCampaignStatusParams,
} from '@/tools/emailbison/types'
import {
  campaignOutputs,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  mapCampaign,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const updateCampaignStatusTool: ToolConfig<
  EmailBisonCampaignStatusParams,
  EmailBisonCampaignResponse
> = {
  id: 'emailbison_update_campaign_status',
  name: 'Email Bison Update Campaign Status',
  description: 'Pauses, resumes, or archives an Email Bison campaign.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email Bison API token',
    },
    campaignId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign ID',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Status action: pause, resume, or archive',
    },
  },
  request: {
    url: (params) => emailBisonUrl(`/api/campaigns/${params.campaignId}/${params.action}`),
    method: 'PATCH',
    headers: emailBisonHeaders,
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
