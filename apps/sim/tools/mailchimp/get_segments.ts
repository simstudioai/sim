import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetSegmentsParams {
  apiKey: string
  listId: string
  count?: string
  offset?: string
}

export interface MailchimpGetSegmentsResponse {
  success: boolean
  output: {
    segments: any[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetSegmentsTool: ToolConfig<
  MailchimpGetSegmentsParams,
  MailchimpGetSegmentsResponse
> = {
  id: 'mailchimp_get_segments',
  name: 'Get Segments from Mailchimp Audience',
  description: 'Retrieve a list of segments from a Mailchimp audience',
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
      const url = buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/segments`)
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
      handleMailchimpError(data, response.status, 'get_segments')
    }

    const data = await response.json()
    const segments = data.segments || []

    return {
      success: true,
      output: {
        segments,
        total_items: data.total_items || segments.length,
        total_returned: segments.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the segments were successfully retrieved' },
    output: {
      type: 'object',
      description: 'Segments data',
      properties: {
        segments: { type: 'json', description: 'Array of segment objects' },
        total_items: { type: 'number', description: 'Total number of segments' },
        total_returned: {
          type: 'number',
          description: 'Number of segments returned in this response',
        },
      },
    },
  },
}
