import { createLogger } from '@sim/logger'
import type { MailchimpSegment } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

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
    segment_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    segmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the segment (e.g., "12345")',
    },
    segmentName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the segment (e.g., "VIP Customers")',
    },
    segmentOptions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of segment options (e.g., {"match": "all", "conditions": [...]})',
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
        segment_id: data.id,
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
        segment_id: { type: 'string', description: 'Segment ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
