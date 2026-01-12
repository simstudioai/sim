import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpBatchOperation } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetBatchOperations')

export interface MailchimpGetBatchOperationsParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetBatchOperationsResponse {
  success: boolean
  output: {
    batches: MailchimpBatchOperation[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetBatchOperationsTool: ToolConfig<
  MailchimpGetBatchOperationsParams,
  MailchimpGetBatchOperationsResponse
> = {
  id: 'mailchimp_get_batch_operations',
  name: 'Get Batch Operations from Mailchimp',
  description: 'Retrieve a list of batch operations from Mailchimp',
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
      const url = buildMailchimpUrl(params.apiKey, '/batches')
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
      handleMailchimpError(data, response.status, 'get_batch_operations')
    }

    const data = await response.json()
    const batches = data.batches || []

    return {
      success: true,
      output: {
        batches,
        total_items: data.total_items || batches.length,
        total_returned: batches.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the batch operations were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Batch operations data',
      properties: {
        batches: { type: 'json', description: 'Array of batch operation objects' },
        total_items: { type: 'number', description: 'Total number of batch operations' },
        total_returned: {
          type: 'number',
          description: 'Number of batch operations returned in this response',
        },
      },
    },
  },
}
