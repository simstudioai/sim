import type { MailchimpAutomation } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetAutomationsParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetAutomationsResponse {
  success: boolean
  output: {
    automations: MailchimpAutomation[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetAutomationsTool: ToolConfig<
  MailchimpGetAutomationsParams,
  MailchimpGetAutomationsResponse
> = {
  id: 'mailchimp_get_automations',
  name: 'Get Automations from Mailchimp',
  description: 'Retrieve a list of automations from Mailchimp',
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
      const url = buildMailchimpUrl(params.apiKey, '/automations')
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
      handleMailchimpError(data, response.status, 'get_automations')
    }

    const data = await response.json()
    const automations = data.automations || []

    return {
      success: true,
      output: {
        automations,
        total_items: data.total_items || automations.length,
        total_returned: automations.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the automations were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Automations data',
      properties: {
        automations: { type: 'json', description: 'Array of automation objects' },
        total_items: { type: 'number', description: 'Total number of automations' },
        total_returned: {
          type: 'number',
          description: 'Number of automations returned in this response',
        },
      },
    },
  },
}
