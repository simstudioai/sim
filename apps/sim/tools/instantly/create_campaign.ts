import type {
  InstantlyCampaignResponse,
  InstantlyCreateCampaignParams,
} from '@/tools/instantly/types'
import {
  campaignOutputs,
  compactBody,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  mapCampaign,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const createCampaignTool: ToolConfig<
  InstantlyCreateCampaignParams,
  InstantlyCampaignResponse
> = {
  id: 'instantly_create_campaign',
  name: 'Instantly Create Campaign',
  description: 'Creates an Instantly V2 campaign using the documented campaign schedule schema.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign name',
    },
    campaign_schedule: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign schedule object with schedules array',
    },
    sequences: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Campaign sequence definitions',
      items: { type: 'object', description: 'Sequence object' },
    },
    email_list: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sending email accounts',
      items: { type: 'string', description: 'Email address' },
    },
    daily_limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Daily sending limit',
    },
    daily_max_leads: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Daily maximum new leads to contact',
    },
    open_tracking: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to track opens',
    },
    stop_on_reply: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to stop the campaign on reply',
    },
    link_tracking: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to track links',
    },
    text_only: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the campaign is text only',
    },
    email_gap: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gap between emails in minutes',
    },
    pl_value: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value of every positive lead',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/campaigns'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) =>
      compactBody({
        name: params.name,
        campaign_schedule: params.campaign_schedule,
        sequences: params.sequences,
        pl_value: params.pl_value,
        email_gap: params.email_gap,
        text_only: params.text_only,
        email_list: params.email_list,
        daily_limit: params.daily_limit,
        stop_on_reply: params.stop_on_reply,
        link_tracking: params.link_tracking,
        open_tracking: params.open_tracking,
        daily_max_leads: params.daily_max_leads,
      }),
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
      },
    }
  },
  outputs: campaignOutputs,
}
