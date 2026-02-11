import type { MailchimpLandingPage } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpUpdateLandingPageParams {
  apiKey: string
  pageId: string
  landingPageTitle?: string
}

export interface MailchimpUpdateLandingPageResponse {
  success: boolean
  output: {
    landingPage: MailchimpLandingPage
    page_id: string
    success: boolean
  }
}

export const mailchimpUpdateLandingPageTool: ToolConfig<
  MailchimpUpdateLandingPageParams,
  MailchimpUpdateLandingPageResponse
> = {
  id: 'mailchimp_update_landing_page',
  name: 'Update Landing Page in Mailchimp',
  description: 'Update an existing landing page in Mailchimp',
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
    landingPageTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The title of the landing page (e.g., "Join Our Newsletter")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/landing-pages/${params.pageId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.landingPageTitle) body.title = params.landingPageTitle

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_landing_page')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        landingPage: data,
        page_id: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated landing page data',
      properties: {
        landingPage: { type: 'object', description: 'Updated landing page object' },
        page_id: { type: 'string', description: 'Landing page ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
