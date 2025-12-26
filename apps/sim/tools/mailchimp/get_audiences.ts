import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAudience } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetAudiences')

export interface MailchimpGetAudiencesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetAudiencesResponse {
  success: boolean
  output: {
    lists: MailchimpAudience[]
    totalItems: number
    metadata: {
      operation: 'get_audiences'
      totalReturned: number
    }
    success: boolean
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
        totalItems: data.total_items || lists.length,
        metadata: {
          operation: 'get_audiences' as const,
          totalReturned: lists.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Audiences data and metadata',
      properties: {
        lists: { type: 'array', description: 'Array of audience/list objects' },
        totalItems: { type: 'number', description: 'Total number of lists' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
