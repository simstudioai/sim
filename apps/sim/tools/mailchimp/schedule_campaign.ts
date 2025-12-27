import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpScheduleCampaign')

export interface MailchimpScheduleCampaignParams {
  apiKey: string
  campaignId: string
  scheduleTime: string
}

export interface MailchimpScheduleCampaignResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'schedule_campaign'
      campaignId: string
      scheduleTime: string
    }
    success: boolean
  }
}

export const mailchimpScheduleCampaignTool: ToolConfig<
  MailchimpScheduleCampaignParams,
  MailchimpScheduleCampaignResponse
> = {
  id: 'mailchimp_schedule_campaign',
  name: 'Schedule Campaign in Mailchimp',
  description: 'Schedule a Mailchimp campaign to be sent at a specific time',
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
      description: 'The unique ID for the campaign to schedule',
    },
    scheduleTime: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ISO 8601 format date and time',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/campaigns/${params.campaignId}/actions/schedule`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      schedule_time: params.scheduleTime,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'schedule_campaign')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'schedule_campaign' as const,
          campaignId: '',
          scheduleTime: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Schedule confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
