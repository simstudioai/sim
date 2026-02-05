import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpUnscheduleCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpUnscheduleCampaignResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpUnscheduleCampaignTool: ToolConfig<
  MailchimpUnscheduleCampaignParams,
  MailchimpUnscheduleCampaignResponse
> = {
  id: 'mailchimp_unschedule_campaign',
  name: 'Unschedule Campaign in Mailchimp',
  description: 'Unschedule a previously scheduled Mailchimp campaign',
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
      description: 'The unique ID for the campaign to unschedule (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/actions/unschedule`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'unschedule_campaign')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Unschedule confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
