import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaignContent } from './types'

const logger = createLogger('MailchimpGetCampaignContent')

export interface MailchimpGetCampaignContentParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignContentResponse {
  success: boolean
  output: {
    content: MailchimpCampaignContent
    metadata: {
      operation: 'get_campaign_content'
      campaignId: string
    }
    success: boolean
  }
}

export const mailchimpGetCampaignContentTool: ToolConfig<
  MailchimpGetCampaignContentParams,
  MailchimpGetCampaignContentResponse
> = {
  id: 'mailchimp_get_campaign_content',
  name: 'Get Campaign Content from Mailchimp',
  description: 'Retrieve the HTML and plain-text content for a Mailchimp campaign',
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
    url: (params) => buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/content`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_campaign_content')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        content: data,
        metadata: {
          operation: 'get_campaign_content' as const,
          campaignId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Campaign content data',
      properties: {
        content: { type: 'object', description: 'Campaign content object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
