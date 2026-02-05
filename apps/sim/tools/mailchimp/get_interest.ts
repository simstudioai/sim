import type { MailchimpInterest } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetInterestParams {
  apiKey: string
  listId: string
  interestCategoryId: string
  interestId: string
}

export interface MailchimpGetInterestResponse {
  success: boolean
  output: {
    interest: MailchimpInterest
    interest_id: string
  }
}

export const mailchimpGetInterestTool: ToolConfig<
  MailchimpGetInterestParams,
  MailchimpGetInterestResponse
> = {
  id: 'mailchimp_get_interest',
  name: 'Get Interest from Mailchimp Interest Category',
  description:
    'Retrieve details of a specific interest from an interest category in a Mailchimp audience',
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
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/interest-categories/${params.interestCategoryId}/interests/${params.interestId}`
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
      handleMailchimpError(data, response.status, 'get_interest')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        interest: data,
        interest_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the interest was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Interest data',
      properties: {
        interest: { type: 'json', description: 'Interest object' },
        interest_id: { type: 'string', description: 'The unique ID of the interest' },
      },
    },
  },
}
