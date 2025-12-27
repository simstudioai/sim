import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpReplicateCampaign')

export interface MailchimpReplicateCampaignParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpReplicateCampaignResponse {
  success: boolean
  output: {
    campaign: any
    metadata: {
      operation: 'replicate_campaign'
      campaignId: string
    }
    success: boolean
  }
}

export const mailchimpReplicateCampaignTool: ToolConfig<
  MailchimpReplicateCampaignParams,
  MailchimpReplicateCampaignResponse
> = {
  id: 'mailchimp_replicate_campaign',
  name: 'Replicate Campaign in Mailchimp',
  description: 'Create a copy of an existing Mailchimp campaign',
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
      description: 'The unique ID for the campaign to replicate',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/actions/replicate`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'replicate_campaign')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        campaign: data,
        metadata: {
          operation: 'replicate_campaign' as const,
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
      description: 'Replicated campaign data',
      properties: {
        campaign: { type: 'object', description: 'Replicated campaign object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
