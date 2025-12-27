import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetSegments')

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
    totalItems: number
    metadata: {
      operation: 'get_segments'
      totalReturned: number
    }
    success: boolean
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
        totalItems: data.total_items || segments.length,
        metadata: {
          operation: 'get_segments' as const,
          totalReturned: segments.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Segments data and metadata',
      properties: {
        segments: { type: 'array', description: 'Array of segment objects' },
        totalItems: { type: 'number', description: 'Total number of segments' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
