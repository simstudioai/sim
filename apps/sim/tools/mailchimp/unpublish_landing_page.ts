import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpUnpublishLandingPage')

export interface MailchimpUnpublishLandingPageParams {
  apiKey: string
  pageId: string
}

export interface MailchimpUnpublishLandingPageResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'unpublish_landing_page'
      pageId: string
    }
    success: boolean
  }
}

export const mailchimpUnpublishLandingPageTool: ToolConfig<
  MailchimpUnpublishLandingPageParams,
  MailchimpUnpublishLandingPageResponse
> = {
  id: 'mailchimp_unpublish_landing_page',
  name: 'Unpublish Landing Page in Mailchimp',
  description: 'Unpublish a landing page in Mailchimp',
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
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/landing-pages/${params.pageId}/actions/unpublish`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'unpublish_landing_page')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'unpublish_landing_page' as const,
          pageId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Unpublish confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
