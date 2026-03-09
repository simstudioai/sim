import type { MailchimpInterest } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpUpdateInterestParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestId: string
  interestName?: string
}

export interface MailchimpUpdateInterestResponse {
  success: boolean
  output: {
    interest: MailchimpInterest
    interest_id: string
    success: boolean
  }
}

export const mailchimpUpdateInterestTool: ToolConfig<
  MailchimpUpdateInterestParams,
  MailchimpUpdateInterestResponse
> = {
  id: 'mailchimp_update_interest',
  name: 'Update Interest in Mailchimp Interest Category',
  description: 'Update an existing interest in an interest category in a Mailchimp audience',
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
    interestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the interest (e.g., "def456")',
    },
    interestName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the interest (e.g., "Weekly Updates")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests/${params.interestId}`
      ),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.interestName) body.name = params.interestName

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_interest')
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
      description: 'Updated interest data',
      properties: {
        interest: { type: 'object', description: 'Updated interest object' },
        interest_id: { type: 'string', description: 'Interest ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
