import type { MailchimpInterestCategory } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryId: string
}

export interface MailchimpGetInterestCategoryResponse {
  success: boolean
  output: {
    category: MailchimpInterestCategory
    interest_category_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    interestCategoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the interest category (e.g., "xyz789")',
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
        interest_category_id: data.id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the interest category was successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Interest category data',
      properties: {
        category: { type: 'json', description: 'Interest category object' },
        interest_category_id: {
          type: 'string',
          description: 'The unique ID of the interest category',
        },
      },
    },
  },
}
