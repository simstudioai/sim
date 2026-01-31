import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaignReport,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetCampaignReportParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignReportResponse {
  success: boolean
  output: {
    report: MailchimpCampaignReport
    campaign_id: string
  }
}

export const mailchimpGetCampaignReportTool: ToolConfig<
  MailchimpGetCampaignReportParams,
  MailchimpGetCampaignReportResponse
> = {
  id: 'mailchimp_get_campaign_report',
  name: 'Get Campaign Report from Mailchimp',
  description: 'Retrieve the report for a specific campaign from Mailchimp',
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
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/reports/${params.campaignId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_campaign_report')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        report: data,
        campaign_id: data.campaign_id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the campaign report was successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Campaign report data',
      properties: {
        report: { type: 'json', description: 'Campaign report object' },
        campaign_id: { type: 'string', description: 'The unique ID of the campaign' },
      },
    },
  },
}
