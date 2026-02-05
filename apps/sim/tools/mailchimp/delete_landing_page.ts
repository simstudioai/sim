import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteLandingPageParams {
  apiKey: string
  pageId: string
}

export interface MailchimpDeleteLandingPageResponse {
  success: boolean
}

export const mailchimpDeleteLandingPageTool: ToolConfig<
  MailchimpDeleteLandingPageParams,
  MailchimpDeleteLandingPageResponse
> = {
  id: 'mailchimp_delete_landing_page',
  name: 'Delete Landing Page from Mailchimp',
  description: 'Delete a landing page from Mailchimp',
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
      description: 'The unique ID for the landing page to delete (e.g., "abc123def4")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/landing-pages/${params.pageId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_landing_page')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the landing page was successfully deleted' },
  },
}
