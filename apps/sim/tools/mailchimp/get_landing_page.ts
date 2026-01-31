import type { MailchimpLandingPage } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetLandingPageParams {
  apiKey: string
  pageId: string
}

export interface MailchimpGetLandingPageResponse {
  success: boolean
  output: {
    landingPage: MailchimpLandingPage
    page_id: string
  }
}

export const mailchimpGetLandingPageTool: ToolConfig<
  MailchimpGetLandingPageParams,
  MailchimpGetLandingPageResponse
> = {
  id: 'mailchimp_get_landing_page',
  name: 'Get Landing Page from Mailchimp',
  description: 'Retrieve details of a specific landing page from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the landing page (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/landing-pages/${params.pageId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_landing_page')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        landingPage: data,
        page_id: data.id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the landing page was successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Landing page data',
      properties: {
        landingPage: { type: 'json', description: 'Landing page object' },
        page_id: { type: 'string', description: 'The unique ID of the landing page' },
      },
    },
  },
}
