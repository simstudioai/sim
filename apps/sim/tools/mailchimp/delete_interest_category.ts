import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteInterestCategoryParams {
  apiKey: string
  listId: string
  interestCategoryId: string
}

export interface MailchimpDeleteInterestCategoryResponse {
  success: boolean
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    interestCategoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the interest category to delete (e.g., "xyz789")',
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
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the interest category was successfully deleted',
    },
  },
}
