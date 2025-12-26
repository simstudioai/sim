import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpSegment } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpUpdateSegment')

export interface MailchimpUpdateSegmentParams {
  apiKey: string
  listId: string
  segmentId: string
  segmentName?: string
  segmentOptions?: string
}

export interface MailchimpUpdateSegmentResponse {
  success: boolean
  output: {
    segment: MailchimpSegment
    metadata: {
      operation: 'update_segment'
      segmentId: string
    }
    success: boolean
  }
}

export const mailchimpUpdateSegmentTool: ToolConfig<
  MailchimpUpdateSegmentParams,
  MailchimpUpdateSegmentResponse
> = {
  id: 'mailchimp_update_segment',
  name: 'Update Segment in Mailchimp Audience',
  description: 'Update an existing segment in a Mailchimp audience',
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
    segmentName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the segment',
    },
    segmentOptions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of segment options',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/segments/${params.segmentId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.segmentName) body.name = params.segmentName

      if (params.segmentOptions) {
        try {
          const options = JSON.parse(params.segmentOptions)
          body.options = options
        } catch (error) {
          logger.warn('Failed to parse segment options', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_segment')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        segment: data,
        metadata: {
          operation: 'update_segment' as const,
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
      description: 'Updated segment data',
      properties: {
        segment: { type: 'object', description: 'Updated segment object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
