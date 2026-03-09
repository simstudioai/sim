import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpScheduleCampaignParams {
  apiKey: string
  campaignId: string
  scheduleTime: string
}

export interface MailchimpScheduleCampaignResponse {
  success: boolean
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the campaign to schedule (e.g., "abc123def4")',
    },
    scheduleTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Schedule time in ISO 8601 format (e.g., "2024-12-25T10:00:00Z")',
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
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the campaign was successfully scheduled' },
  },
}
