import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaign } from './types'

const logger = createLogger('MailchimpGetCampaign')

export interface MailchimpGetCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignResponse {
  success: boolean
  output: {
    campaign: MailchimpCampaign
    metadata: {
      operation: 'get_campaign'
      campaignId: string
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the campaign',
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
        metadata: {
          operation: 'get_campaign' as const,
          campaignId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Campaign data and metadata',
      properties: {
        campaign: { type: 'object', description: 'Campaign object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
