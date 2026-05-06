import type {
  EmailBisonCampaignResponse,
  EmailBisonCampaignStatusParams,
} from '@/tools/emailbison/types'
import {
  campaignOutputs,
  emailBisonBaseParamFields,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  mapCampaign,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

const CAMPAIGN_STATUS_ACTIONS = new Set(['pause', 'resume', 'archive'])

export const updateCampaignStatusTool: ToolConfig<
  EmailBisonCampaignStatusParams,
  EmailBisonCampaignResponse
> = {
  id: 'emailbison_update_campaign_status',
  name: 'Email Bison Update Campaign Status',
  description: 'Pauses, resumes, or archives an Email Bison campaign.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
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
    url: (params) => {
      if (!CAMPAIGN_STATUS_ACTIONS.has(params.action)) {
        throw new Error('Email Bison campaign status action must be pause, resume, or archive')
      }

      return emailBisonUrl(
        `/api/campaigns/${params.campaignId}/${params.action}`,
        {},
        params.apiBaseUrl
      )
    },
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
