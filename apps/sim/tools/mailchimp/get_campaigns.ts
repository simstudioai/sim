import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaign } from './types'

const logger = createLogger('MailchimpGetCampaigns')

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
    totalItems: number
    metadata: {
      operation: 'get_campaigns'
      totalReturned: number
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'Filter by campaign type (regular, plaintext, absplit, rss, variate)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by status (save, paused, schedule, sending, sent)',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
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
        totalItems: data.total_items || campaigns.length,
        metadata: {
          operation: 'get_campaigns' as const,
          totalReturned: campaigns.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Campaigns data and metadata',
      properties: {
        campaigns: { type: 'array', description: 'Array of campaign objects' },
        totalItems: { type: 'number', description: 'Total number of campaigns' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
