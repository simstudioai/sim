import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteSegment')

export interface MailchimpDeleteSegmentParams {
  apiKey: string
  listId: string
  segmentId: string
}

export interface MailchimpDeleteSegmentResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_segment'
      segmentId: string
    }
    success: boolean
  }
}

export const mailchimpDeleteSegmentTool: ToolConfig<
  MailchimpDeleteSegmentParams,
  MailchimpDeleteSegmentResponse
> = {
  id: 'mailchimp_delete_segment',
  name: 'Delete Segment from Mailchimp Audience',
  description: 'Delete a segment from a Mailchimp audience',
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
      description: 'The unique ID for the segment to delete',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/segments/${params.segmentId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_segment')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_segment' as const,
          segmentId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
