import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpSegment } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetSegment')

export interface MailchimpGetSegmentParams {
  apiKey: string
  listId: string
  segmentId: string
}

export interface MailchimpGetSegmentResponse {
  success: boolean
  output: {
    segment: MailchimpSegment
    metadata: {
      operation: 'get_segment'
      segmentId: string
    }
    success: boolean
  }
}

export const mailchimpGetSegmentTool: ToolConfig<
  MailchimpGetSegmentParams,
  MailchimpGetSegmentResponse
> = {
  id: 'mailchimp_get_segment',
  name: 'Get Segment from Mailchimp Audience',
  description: 'Retrieve details of a specific segment from a Mailchimp audience',
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
    segmentId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the segment',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/segments/${params.segmentId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_segment')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        segment: data,
        metadata: {
          operation: 'get_segment' as const,
          segmentId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Segment data and metadata',
      properties: {
        segment: { type: 'object', description: 'Segment object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
