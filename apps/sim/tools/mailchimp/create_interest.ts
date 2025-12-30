import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpInterest } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpCreateInterest')

export interface MailchimpCreateInterestParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestName: string
}

export interface MailchimpCreateInterestResponse {
  success: boolean
  output: {
    interest: MailchimpInterest
    metadata: {
      operation: 'create_interest'
      interestId: string
    }
    success: boolean
  }
}

export const mailchimpCreateInterestTool: ToolConfig<
  MailchimpCreateInterestParams,
  MailchimpCreateInterestResponse
> = {
  id: 'mailchimp_create_interest',
  name: 'Create Interest in Mailchimp Interest Category',
  description: 'Create a new interest in an interest category in a Mailchimp audience',
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
    interestName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the interest',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.interestName,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_interest')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        interest: data,
        metadata: {
          operation: 'create_interest' as const,
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
      description: 'Created interest data',
      properties: {
        interest: { type: 'object', description: 'Created interest object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
