import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaignReport } from './types'

const logger = createLogger('MailchimpGetCampaignReport')

export interface MailchimpGetCampaignReportParams {
  apiKey: string
  campaignId: string
}

export interface MailchimpGetCampaignReportResponse {
  success: boolean
  output: {
    report: MailchimpCampaignReport
    metadata: {
      operation: 'get_campaign_report'
      campaignId: string
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the campaign',
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
        metadata: {
          operation: 'get_campaign_report' as const,
          campaignId: data.campaign_id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Campaign report data and metadata',
      properties: {
        report: { type: 'object', description: 'Campaign report object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
