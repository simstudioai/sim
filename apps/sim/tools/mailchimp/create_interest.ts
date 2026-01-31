import type { MailchimpInterest } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

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
    interest_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    interestCategoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the interest category (e.g., "xyz789")',
    },
    interestName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the interest (e.g., "Weekly Updates")',
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
        interest_id: data.id,
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
        interest: { type: 'json', description: 'Created interest object' },
        interest_id: { type: 'string', description: 'Created interest ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
