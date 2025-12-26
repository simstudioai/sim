import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAutomation } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetAutomations')

export interface MailchimpGetAutomationsParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetAutomationsResponse {
  success: boolean
  output: {
    automations: MailchimpAutomation[]
    totalItems: number
    metadata: {
      operation: 'get_automations'
      totalReturned: number
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
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
        totalItems: data.total_items || automations.length,
        metadata: {
          operation: 'get_automations' as const,
          totalReturned: automations.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Automations data and metadata',
      properties: {
        automations: { type: 'array', description: 'Array of automation objects' },
        totalItems: { type: 'number', description: 'Total number of automations' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
