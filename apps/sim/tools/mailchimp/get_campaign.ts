import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaign,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignResponse {
  success: boolean
  output: {
    campaign: MailchimpCampaign
    campaign_id: string
  }
}

export const mailchimpGetCampaignTool: ToolConfig<
  MailchimpGetCampaignParams,
  MailchimpGetCampaignResponse
> = {
  id: 'mailchimp_get_campaign',
  name: 'Get Campaign from Mailchimp',
  description: 'Retrieve details of a specific campaign from Mailchimp',
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
      description: 'The unique ID for the campaign (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_campaign')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        campaign: data,
        campaign_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the campaign was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Campaign data',
      properties: {
        campaign: { type: 'json', description: 'Campaign object' },
        campaign_id: { type: 'string', description: 'The unique ID of the campaign' },
      },
    },
  },
}
