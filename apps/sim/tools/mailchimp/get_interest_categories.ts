import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetInterestCategoriesParams {
  apiKey: string
  listId: string
  count?: string
  offset?: string
}

export interface MailchimpGetInterestCategoriesResponse {
  success: boolean
  output: {
    categories: any[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetInterestCategoriesTool: ToolConfig<
  MailchimpGetInterestCategoriesParams,
  MailchimpGetInterestCategoriesResponse
> = {
  id: 'mailchimp_get_interest_categories',
  name: 'Get Interest Categories from Mailchimp Audience',
  description: 'Retrieve a list of interest categories from a Mailchimp audience',
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
      const url = buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/interest-categories`)
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
      handleMailchimpError(data, response.status, 'get_interest_categories')
    }

    const data = await response.json()
    const categories = data.categories || []

    return {
      success: true,
      output: {
        categories,
        total_items: data.total_items || categories.length,
        total_returned: categories.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the interest categories were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Interest categories data',
      properties: {
        categories: { type: 'json', description: 'Array of interest category objects' },
        total_items: { type: 'number', description: 'Total number of categories' },
        total_returned: {
          type: 'number',
          description: 'Number of categories returned in this response',
        },
      },
    },
  },
}
