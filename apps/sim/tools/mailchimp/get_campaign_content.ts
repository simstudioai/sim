import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaignContent,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetCampaignContentParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignContentResponse {
  success: boolean
  output: {
    content: MailchimpCampaignContent
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the campaign (e.g., "abc123def4")',
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
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the campaign content was successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Campaign content data',
      properties: {
        content: { type: 'json', description: 'Campaign content object' },
      },
    },
  },
}
