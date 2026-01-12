import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpMergeField } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetMergeFields')

export interface MailchimpGetMergeFieldsParams {
  apiKey: string
  listId: string
  count?: string
  offset?: string
}

export interface MailchimpGetMergeFieldsResponse {
  success: boolean
  output: {
    mergeFields: MailchimpMergeField[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetMergeFieldsTool: ToolConfig<
  MailchimpGetMergeFieldsParams,
  MailchimpGetMergeFieldsResponse
> = {
  id: 'mailchimp_get_merge_fields',
  name: 'Get Merge Fields from Mailchimp Audience',
  description: 'Retrieve a list of merge fields from a Mailchimp audience',
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
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
      const url = buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/merge-fields`)
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
      handleMailchimpError(data, response.status, 'get_merge_fields')
    }

    const data = await response.json()
    const mergeFields = data.merge_fields || []

    return {
      success: true,
      output: {
        mergeFields,
        total_items: data.total_items || mergeFields.length,
        total_returned: mergeFields.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the merge fields were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Merge fields data',
      properties: {
        mergeFields: { type: 'json', description: 'Array of merge field objects' },
        total_items: { type: 'number', description: 'Total number of merge fields' },
        total_returned: {
          type: 'number',
          description: 'Number of merge fields returned in this response',
        },
      },
    },
  },
}
