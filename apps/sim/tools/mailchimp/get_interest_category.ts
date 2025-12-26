import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpInterestCategory } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetInterestCategory')

export interface MailchimpGetInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryId: string
}

export interface MailchimpGetInterestCategoryResponse {
  success: boolean
  output: {
    category: MailchimpInterestCategory
    metadata: {
      operation: 'get_interest_category'
      interestCategoryId: string
    }
    success: boolean
  }
}

export const mailchimpGetInterestCategoryTool: ToolConfig<
  MailchimpGetInterestCategoryParams,
  MailchimpGetInterestCategoryResponse
> = {
  id: 'mailchimp_get_interest_category',
  name: 'Get Interest Category from Mailchimp Audience',
  description: 'Retrieve details of a specific interest category from a Mailchimp audience',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    interestCategoryId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the interest category',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}`
      ),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_interest_category')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        category: data,
        metadata: {
          operation: 'get_interest_category' as const,
          interestCategoryId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Interest category data and metadata',
      properties: {
        category: { type: 'object', description: 'Interest category object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
