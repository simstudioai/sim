import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpLandingPage } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetLandingPage')

export interface MailchimpGetLandingPageParams {
  apiKey: string
  pageId: string
}

export interface MailchimpGetLandingPageResponse {
  success: boolean
  output: {
    landingPage: MailchimpLandingPage
    metadata: {
      operation: 'get_landing_page'
      pageId: string
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the landing page',
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
        metadata: {
          operation: 'get_landing_page' as const,
          pageId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Landing page data and metadata',
      properties: {
        landingPage: { type: 'object', description: 'Landing page object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
