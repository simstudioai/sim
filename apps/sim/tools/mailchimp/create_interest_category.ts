import type { MailchimpInterestCategory } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpCreateInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryTitle: string
  interestCategoryType: string
}

export interface MailchimpCreateInterestCategoryResponse {
  success: boolean
  output: {
    category: MailchimpInterestCategory
    interest_category_id: string
    success: boolean
  }
}

export const mailchimpCreateInterestCategoryTool: ToolConfig<
  MailchimpCreateInterestCategoryParams,
  MailchimpCreateInterestCategoryResponse
> = {
  id: 'mailchimp_create_interest_category',
  name: 'Create Interest Category in Mailchimp Audience',
  description: 'Create a new interest category in a Mailchimp audience',
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
    interestCategoryTitle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the interest category (e.g., "Email Preferences")',
    },
    interestCategoryType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of interest category: "checkboxes", "dropdown", "radio", or "hidden"',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/interest-categories`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      title: params.interestCategoryTitle,
      type: params.interestCategoryType,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_interest_category')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        category: data,
        interest_category_id: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created interest category data',
      properties: {
        category: { type: 'json', description: 'Created interest category object' },
        interest_category_id: { type: 'string', description: 'Created interest category ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
