import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteInterestCategory')

export interface MailchimpDeleteInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryId: string
}

export interface MailchimpDeleteInterestCategoryResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_interest_category'
      interestCategoryId: string
    }
    success: boolean
  }
}

export const mailchimpDeleteInterestCategoryTool: ToolConfig<
  MailchimpDeleteInterestCategoryParams,
  MailchimpDeleteInterestCategoryResponse
> = {
  id: 'mailchimp_delete_interest_category',
  name: 'Delete Interest Category from Mailchimp Audience',
  description: 'Delete an interest category from a Mailchimp audience',
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
      description: 'The unique ID for the interest category to delete',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}`
      ),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_interest_category')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_interest_category' as const,
          interestCategoryId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
