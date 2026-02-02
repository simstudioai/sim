import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpDeleteCampaignResponse {
  success: boolean
}

export const mailchimpDeleteCampaignTool: ToolConfig<
  MailchimpDeleteCampaignParams,
  MailchimpDeleteCampaignResponse
> = {
  id: 'mailchimp_delete_campaign',
  name: 'Delete Campaign from Mailchimp',
  description: 'Delete a campaign from Mailchimp',
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
      description: 'The unique ID for the campaign to delete (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_campaign')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the campaign was successfully deleted' },
  },
}
