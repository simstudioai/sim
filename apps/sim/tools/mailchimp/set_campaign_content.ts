import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaignContent,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpSetCampaignContentParams {
  apiKey: string
  campaignId: string
  html?: string
  plainText?: string
  templateId?: string
}

export interface MailchimpSetCampaignContentResponse {
  success: boolean
  output: {
    content: MailchimpCampaignContent
    success: boolean
  }
}

export const mailchimpSetCampaignContentTool: ToolConfig<
  MailchimpSetCampaignContentParams,
  MailchimpSetCampaignContentResponse
> = {
  id: 'mailchimp_set_campaign_content',
  name: 'Set Campaign Content in Mailchimp',
  description: 'Set the content for a Mailchimp campaign',
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
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The HTML content for the campaign',
    },
    plainText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The plain-text content for the campaign',
    },
    templateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The unique ID of the template to use (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/content`),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.html) body.html = params.html
      if (params.plainText) body.plain_text = params.plainText
      if (params.templateId) body.template = { id: params.templateId }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'set_campaign_content')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        content: data,
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
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
