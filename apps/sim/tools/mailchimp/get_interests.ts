import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

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
    total_items: number
    total_returned: number
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    interestCategoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the interest category (e.g., "xyz789")',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination',
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
        total_items: data.total_items || interests.length,
        total_returned: interests.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the interests were successfully retrieved' },
    output: {
      type: 'object',
      description: 'Interests data',
      properties: {
        interests: { type: 'json', description: 'Array of interest objects' },
        total_items: { type: 'number', description: 'Total number of interests' },
        total_returned: {
          type: 'number',
          description: 'Number of interests returned in this response',
        },
      },
    },
  },
}
