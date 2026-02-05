import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpCampaignReport,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetCampaignReportsParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetCampaignReportsResponse {
  success: boolean
  output: {
    reports: MailchimpCampaignReport[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetCampaignReportsTool: ToolConfig<
  MailchimpGetCampaignReportsParams,
  MailchimpGetCampaignReportsResponse
> = {
  id: 'mailchimp_get_campaign_reports',
  name: 'Get Campaign Reports from Mailchimp',
  description: 'Retrieve a list of campaign reports from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.count) queryParams.append('count', params.count)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildMailchimpUrl(params.apiKey, '/reports')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_campaign_reports')
    }

    const data = await response.json()
    const reports = data.reports || []

    return {
      success: true,
      output: {
        reports,
        total_items: data.total_items || reports.length,
        total_returned: reports.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the campaign reports were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Campaign reports data',
      properties: {
        reports: { type: 'json', description: 'Array of campaign report objects' },
        total_items: { type: 'number', description: 'Total number of reports' },
        total_returned: {
          type: 'number',
          description: 'Number of reports returned in this response',
        },
      },
    },
  },
}
