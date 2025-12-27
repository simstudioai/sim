import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpCampaignReport } from './types'

const logger = createLogger('MailchimpGetCampaignReports')

export interface MailchimpGetCampaignReportsParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetCampaignReportsResponse {
  success: boolean
  output: {
    reports: MailchimpCampaignReport[]
    totalItems: number
    metadata: {
      operation: 'get_campaign_reports'
      totalReturned: number
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
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
        totalItems: data.total_items || reports.length,
        metadata: {
          operation: 'get_campaign_reports' as const,
          totalReturned: reports.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Campaign reports data and metadata',
      properties: {
        reports: { type: 'array', description: 'Array of campaign report objects' },
        totalItems: { type: 'number', description: 'Total number of reports' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
