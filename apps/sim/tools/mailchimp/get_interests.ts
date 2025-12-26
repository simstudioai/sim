import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetInterests')

export interface MailchimpGetInterestsParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  count?: string
  offset?: string
}

export interface MailchimpGetInterestsResponse {
  success: boolean
  output: {
    interests: any[]
    totalItems: number
    metadata: {
      operation: 'get_interests'
      totalReturned: number
    }
    success: boolean
  }
}

export const mailchimpGetInterestsTool: ToolConfig<
  MailchimpGetInterestsParams,
  MailchimpGetInterestsResponse
> = {
  id: 'mailchimp_get_interests',
  name: 'Get Interests from Mailchimp Interest Category',
  description: 'Retrieve a list of interests from an interest category in a Mailchimp audience',
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
    count: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.count) queryParams.append('count', params.count)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests`
      )
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_interests')
    }

    const data = await response.json()
    const interests = data.interests || []

    return {
      success: true,
      output: {
        interests,
        totalItems: data.total_items || interests.length,
        metadata: {
          operation: 'get_interests' as const,
          totalReturned: interests.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Interests data and metadata',
      properties: {
        interests: { type: 'array', description: 'Array of interest objects' },
        totalItems: { type: 'number', description: 'Total number of interests' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
