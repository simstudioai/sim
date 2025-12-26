import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteInterest')

export interface MailchimpDeleteInterestParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestId: string
}

export interface MailchimpDeleteInterestResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_interest'
      interestId: string
    }
    success: boolean
  }
}

export const mailchimpDeleteInterestTool: ToolConfig<
  MailchimpDeleteInterestParams,
  MailchimpDeleteInterestResponse
> = {
  id: 'mailchimp_delete_interest',
  name: 'Delete Interest from Mailchimp Interest Category',
  description: 'Delete an interest from an interest category in a Mailchimp audience',
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
    interestId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the interest to delete',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests/${params.interestId}`
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
      handleMailchimpError(data, response.status, 'delete_interest')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_interest' as const,
          interestId: '',
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
