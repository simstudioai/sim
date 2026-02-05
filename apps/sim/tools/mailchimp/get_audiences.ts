import type { MailchimpAudience } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetAudiencesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetAudiencesResponse {
  success: boolean
  output: {
    lists: MailchimpAudience[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetAudiencesTool: ToolConfig<
  MailchimpGetAudiencesParams,
  MailchimpGetAudiencesResponse
> = {
  id: 'mailchimp_get_audiences',
  name: 'Get Audiences from Mailchimp',
  description: 'Retrieve a list of audiences (lists) from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
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
      const url = buildMailchimpUrl(params.apiKey, '/lists')
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
      handleMailchimpError(data, response.status, 'get_audiences')
    }

    const data = await response.json()
    const lists = data.lists || []

    return {
      success: true,
      output: {
        lists,
        total_items: data.total_items || lists.length,
        total_returned: lists.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the audiences were successfully retrieved' },
    output: {
      type: 'object',
      description: 'Audiences data',
      properties: {
        lists: { type: 'json', description: 'Array of audience/list objects' },
        total_items: { type: 'number', description: 'Total number of lists' },
        total_returned: {
          type: 'number',
          description: 'Number of lists returned in this response',
        },
      },
    },
  },
}
