import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpReplicateCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpReplicateCampaignResponse {
  success: boolean
  output: {
    campaign: unknown
    campaign_id: string
    success: boolean
  }
}

export const mailchimpReplicateCampaignTool: ToolConfig<
  MailchimpReplicateCampaignParams,
  MailchimpReplicateCampaignResponse
> = {
  id: 'mailchimp_replicate_campaign',
  name: 'Replicate Campaign in Mailchimp',
  description: 'Create a copy of an existing Mailchimp campaign',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the campaign to replicate (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/actions/replicate`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'replicate_campaign')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        campaign: data,
        campaign_id: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Replicated campaign data',
      properties: {
        campaign: { type: 'object', description: 'Replicated campaign object' },
        campaign_id: { type: 'string', description: 'Campaign ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
