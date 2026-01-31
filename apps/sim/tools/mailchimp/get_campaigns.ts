import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaign,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetCampaignsParams {
  apiKey: string
  campaignType?: string
  status?: string
  count?: string
  offset?: string
}

export interface MailchimpGetCampaignsResponse {
  success: boolean
  output: {
    campaigns: MailchimpCampaign[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetCampaignsTool: ToolConfig<
  MailchimpGetCampaignsParams,
  MailchimpGetCampaignsResponse
> = {
  id: 'mailchimp_get_campaigns',
  name: 'Get Campaigns from Mailchimp',
  description: 'Retrieve a list of campaigns from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    campaignType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by campaign type: "regular", "plaintext", "absplit", "rss", or "variate"',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status: "save", "paused", "schedule", "sending", or "sent"',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.campaignType) queryParams.append('type', params.campaignType)
      if (params.status) queryParams.append('status', params.status)
      if (params.count) queryParams.append('count', params.count)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildMailchimpUrl(params.apiKey, '/campaigns')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_campaigns')
    }

    const data = await response.json()
    const campaigns = data.campaigns || []

    return {
      success: true,
      output: {
        campaigns,
        total_items: data.total_items || campaigns.length,
        total_returned: campaigns.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the campaigns were successfully retrieved' },
    output: {
      type: 'object',
      description: 'Campaigns data',
      properties: {
        campaigns: { type: 'json', description: 'Array of campaign objects' },
        total_items: { type: 'number', description: 'Total number of campaigns' },
        total_returned: {
          type: 'number',
          description: 'Number of campaigns returned in this response',
        },
      },
    },
  },
}
