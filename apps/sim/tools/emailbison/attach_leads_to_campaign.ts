import type {
  EmailBisonActionResponse,
  EmailBisonAttachLeadsParams,
} from '@/tools/emailbison/types'
import {
  actionOutput,
  actionOutputs,
  emailBisonHeaders,
  emailBisonRecordData,
  emailBisonUrl,
  jsonBody,
} from '@/tools/emailbison/utils'
import type { ToolConfig } from '@/tools/types'

export const attachLeadsToCampaignTool: ToolConfig<
  EmailBisonAttachLeadsParams,
  EmailBisonActionResponse
> = {
  id: 'emailbison_attach_leads_to_campaign',
  name: 'Email Bison Attach Leads to Campaign',
  description: 'Adds existing Email Bison leads to a campaign.',
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
    leadIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lead IDs to add to the campaign',
      items: { type: 'number', description: 'Lead ID' },
    },
    allowParallelSending: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Force add leads already in sequence in other campaigns',
    },
  },
  request: {
    url: (params) => emailBisonUrl(`/api/campaigns/${params.campaignId}/leads/attach-leads`),
    method: 'POST',
    headers: emailBisonHeaders,
    body: (params) =>
      jsonBody({
        lead_ids: params.leadIds,
        allow_parallel_sending: params.allowParallelSending,
      }),
  },
  transformResponse: async (response) => {
    const data = await emailBisonRecordData(response, 'campaign lead attachment result')

    return {
      success: true,
      output: actionOutput(data),
    }
  },
  outputs: actionOutputs,
}
