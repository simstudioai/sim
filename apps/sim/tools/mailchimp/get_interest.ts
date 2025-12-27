import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpInterest } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetInterest')

export interface MailchimpGetInterestParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestId: string
}

export interface MailchimpGetInterestResponse {
  success: boolean
  output: {
    interest: MailchimpInterest
    metadata: {
      operation: 'get_interest'
      interestId: string
    }
    success: boolean
  }
}

export const mailchimpGetInterestTool: ToolConfig<
  MailchimpGetInterestParams,
  MailchimpGetInterestResponse
> = {
  id: 'mailchimp_get_interest',
  name: 'Get Interest from Mailchimp Interest Category',
  description:
    'Retrieve details of a specific interest from an interest category in a Mailchimp audience',
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
      description: 'The unique ID for the interest',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests/${params.interestId}`
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
      handleMailchimpError(data, response.status, 'get_interest')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        interest: data,
        metadata: {
          operation: 'get_interest' as const,
          interestId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Interest data and metadata',
      properties: {
        interest: { type: 'object', description: 'Interest object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
