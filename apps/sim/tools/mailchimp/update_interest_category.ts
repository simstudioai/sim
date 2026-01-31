import type { MailchimpInterestCategory } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpUpdateInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestCategoryTitle?: string
}

export interface MailchimpUpdateInterestCategoryResponse {
  success: boolean
  output: {
    category: MailchimpInterestCategory
    interest_category_id: string
    success: boolean
  }
}

export const mailchimpUpdateInterestCategoryTool: ToolConfig<
  MailchimpUpdateInterestCategoryParams,
  MailchimpUpdateInterestCategoryResponse
> = {
  id: 'mailchimp_update_interest_category',
  name: 'Update Interest Category in Mailchimp Audience',
  description: 'Update an existing interest category in a Mailchimp audience',
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
    interestCategoryTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The title of the interest category (e.g., "Email Preferences")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}`
      ),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.interestCategoryTitle) body.title = params.interestCategoryTitle

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_interest_category')
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
      description: 'Updated interest category data',
      properties: {
        category: { type: 'object', description: 'Updated interest category object' },
        interest_category_id: { type: 'string', description: 'Interest category ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
