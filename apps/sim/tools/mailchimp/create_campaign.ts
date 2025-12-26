import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaign } from './types'

const logger = createLogger('MailchimpCreateCampaign')

export interface MailchimpCreateCampaignParams {
  apiKey: string
  campaignType: string
  campaignSettings: string
  recipients?: string
}

export interface MailchimpCreateCampaignResponse {
  success: boolean
  output: {
    campaign: MailchimpCampaign
    metadata: {
      operation: 'create_campaign'
      campaignId: string
    }
    success: boolean
  }
}

export const mailchimpCreateCampaignTool: ToolConfig<
  MailchimpCreateCampaignParams,
  MailchimpCreateCampaignResponse
> = {
  id: 'mailchimp_create_campaign',
  name: 'Create Campaign in Mailchimp',
  description: 'Create a new campaign in Mailchimp',
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
      required: true,
      visibility: 'user-only',
      description: 'Campaign type',
    },
    campaignSettings: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON object of campaign settings',
    },
    recipients: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of recipients',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, '/campaigns'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: params.campaignType,
      }

      if (params.campaignSettings) {
        try {
          body.settings = JSON.parse(params.campaignSettings)
        } catch (error) {
          logger.warn('Failed to parse campaign settings', { error })
        }
      }

      if (params.recipients) {
        try {
          body.recipients = JSON.parse(params.recipients)
        } catch (error) {
          logger.warn('Failed to parse recipients', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_campaign')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        campaign: data,
        metadata: {
          operation: 'create_campaign' as const,
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
      description: 'Created campaign data',
      properties: {
        campaign: { type: 'object', description: 'Created campaign object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
