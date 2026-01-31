import type { MailchimpLandingPage } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpCreateLandingPageParams {
  apiKey: string
  landingPageType: string
  landingPageTitle?: string
}

export interface MailchimpCreateLandingPageResponse {
  success: boolean
  output: {
    landingPage: MailchimpLandingPage
    page_id: string
    success: boolean
  }
}

export const mailchimpCreateLandingPageTool: ToolConfig<
  MailchimpCreateLandingPageParams,
  MailchimpCreateLandingPageResponse
> = {
  id: 'mailchimp_create_landing_page',
  name: 'Create Landing Page in Mailchimp',
  description: 'Create a new landing page in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    landingPageType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of landing page: "signup"',
    },
    landingPageTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The title of the landing page (e.g., "Join Our Newsletter")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, '/landing-pages'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: params.landingPageType,
      }

      if (params.landingPageTitle) body.title = params.landingPageTitle

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_landing_page')
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
      description: 'Created landing page data',
      properties: {
        landingPage: { type: 'json', description: 'Created landing page object' },
        page_id: { type: 'string', description: 'Created landing page ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
