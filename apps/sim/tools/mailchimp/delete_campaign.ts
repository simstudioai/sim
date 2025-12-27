import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteCampaign')

export interface MailchimpDeleteCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpDeleteCampaignResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_campaign'
      campaignId: string
    }
    success: boolean
  }
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
      visibility: 'user-only',
      description: 'The unique ID for the campaign to delete',
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
      output: {
        metadata: {
          operation: 'delete_campaign' as const,
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
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
