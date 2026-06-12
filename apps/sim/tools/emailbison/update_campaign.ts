import type {
  EmailBisonCampaignResponse,
  EmailBisonUpdateCampaignParams,
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

export const updateCampaignTool: ToolConfig<
  EmailBisonUpdateCampaignParams,
  EmailBisonCampaignResponse
> = {
  id: 'emailbison_update_campaign',
  name: 'Email Bison Update Campaign',
  description: 'Updates Email Bison campaign settings.',
  version: '1.0.0',
  params: {
    ...emailBisonBaseParamFields,
    campaignId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign ID',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign name',
    },
    maxEmailsPerDay: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum emails per day',
    },
    maxNewLeadsPerDay: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum new leads per day',
    },
    plainText: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send plain text emails',
    },
    openTracking: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable open tracking',
    },
    reputationBuilding: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable reputation building',
    },
    canUnsubscribe: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable unsubscribe link',
    },
    includeAutoRepliesInStats: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include auto replies in campaign stats',
    },
    sequencePrioritization: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sequence prioritization: followups or new_leads',
    },
  },
  request: {
    url: (params) =>
      emailBisonUrl(`/api/campaigns/${params.campaignId}/update`, {}, params.apiBaseUrl),
    method: 'PATCH',
    headers: emailBisonHeaders,
    body: (params) =>
      jsonBody({
        name: params.name,
        max_emails_per_day: params.maxEmailsPerDay,
        max_new_leads_per_day: params.maxNewLeadsPerDay,
        plain_text: params.plainText,
        open_tracking: params.openTracking,
        reputation_building: params.reputationBuilding,
        can_unsubscribe: params.canUnsubscribe,
        include_auto_replies_in_stats: params.includeAutoRepliesInStats,
        sequence_prioritization: params.sequencePrioritization,
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
