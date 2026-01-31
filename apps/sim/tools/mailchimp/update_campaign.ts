import { createLogger } from '@sim/logger'
import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaign,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MailchimpUpdateCampaign')

export interface MailchimpUpdateCampaignParams {
  apiKey: string
  campaignId: string
  campaignSettings?: string
  recipients?: string
}

export interface MailchimpUpdateCampaignResponse {
  success: boolean
  output: {
    campaign: MailchimpCampaign
    campaign_id: string
    success: boolean
  }
}

export const mailchimpUpdateCampaignTool: ToolConfig<
  MailchimpUpdateCampaignParams,
  MailchimpUpdateCampaignResponse
> = {
  id: 'mailchimp_update_campaign',
  name: 'Update Campaign in Mailchimp',
  description: 'Update an existing campaign in Mailchimp',
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
    campaignSettings: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of campaign settings (e.g., {"subject_line": "Newsletter", "from_name": "Acme"})',
    },
    recipients: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of recipients (e.g., {"list_id": "abc123"})',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

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
      handleMailchimpError(data, response.status, 'update_campaign')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        campaign: data,
        campaign_id: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated campaign data',
      properties: {
        campaign: { type: 'object', description: 'Updated campaign object' },
        campaign_id: { type: 'string', description: 'Campaign ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
