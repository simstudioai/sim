import type { MailchimpLandingPage } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetLandingPagesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetLandingPagesResponse {
  success: boolean
  output: {
    landingPages: MailchimpLandingPage[]
    total_items: number
    total_returned: number
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
        total_items: data.total_items || landingPages.length,
        total_returned: landingPages.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the landing pages were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Landing pages data',
      properties: {
        landingPages: { type: 'json', description: 'Array of landing page objects' },
        total_items: { type: 'number', description: 'Total number of landing pages' },
        total_returned: {
          type: 'number',
          description: 'Number of landing pages returned in this response',
        },
      },
    },
  },
}
