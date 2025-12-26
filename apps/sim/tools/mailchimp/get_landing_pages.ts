import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpLandingPage } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetLandingPages')

export interface MailchimpGetLandingPagesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetLandingPagesResponse {
  success: boolean
  output: {
    landingPages: MailchimpLandingPage[]
    totalItems: number
    metadata: {
      operation: 'get_landing_pages'
      totalReturned: number
    }
    success: boolean
  }
}

export const mailchimpGetLandingPagesTool: ToolConfig<
  MailchimpGetLandingPagesParams,
  MailchimpGetLandingPagesResponse
> = {
  id: 'mailchimp_get_landing_pages',
  name: 'Get Landing Pages from Mailchimp',
  description: 'Retrieve a list of landing pages from Mailchimp',
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
      const url = buildMailchimpUrl(params.apiKey, '/landing-pages')
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
      handleMailchimpError(data, response.status, 'get_landing_pages')
    }

    const data = await response.json()
    const landingPages = data.landing_pages || []

    return {
      success: true,
      output: {
        landingPages,
        totalItems: data.total_items || landingPages.length,
        metadata: {
          operation: 'get_landing_pages' as const,
          totalReturned: landingPages.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Landing pages data and metadata',
      properties: {
        landingPages: { type: 'array', description: 'Array of landing page objects' },
        totalItems: { type: 'number', description: 'Total number of landing pages' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
