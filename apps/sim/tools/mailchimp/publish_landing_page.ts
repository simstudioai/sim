import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpPublishLandingPageParams {
  apiKey: string
  pageId: string
}

export interface MailchimpPublishLandingPageResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpPublishLandingPageTool: ToolConfig<
  MailchimpPublishLandingPageParams,
  MailchimpPublishLandingPageResponse
> = {
  id: 'mailchimp_publish_landing_page',
  name: 'Publish Landing Page in Mailchimp',
  description: 'Publish a landing page in Mailchimp',
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
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/landing-pages/${params.pageId}/actions/publish`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'publish_landing_page')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Publish confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
