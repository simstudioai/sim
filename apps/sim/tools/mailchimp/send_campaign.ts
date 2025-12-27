import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpSendCampaign')

export interface MailchimpSendCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpSendCampaignResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'send_campaign'
      campaignId: string
    }
    success: boolean
  }
}

export const mailchimpSendCampaignTool: ToolConfig<
  MailchimpSendCampaignParams,
  MailchimpSendCampaignResponse
> = {
  id: 'mailchimp_send_campaign',
  name: 'Send Campaign in Mailchimp',
  description: 'Send a Mailchimp campaign',
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
      description: 'The unique ID for the campaign to send',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/actions/send`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'send_campaign')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'send_campaign' as const,
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
      description: 'Send confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
