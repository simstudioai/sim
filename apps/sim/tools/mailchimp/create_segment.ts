import { createLogger } from '@sim/logger'
import type { MailchimpSegment } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MailchimpCreateSegment')

export interface MailchimpCreateSegmentParams {
  apiKey: string
  listId: string
  segmentName: string
  segmentOptions?: string
}

export interface MailchimpCreateSegmentResponse {
  success: boolean
  output: {
    segment: MailchimpSegment
    segment_id: string
    success: boolean
  }
}

export const mailchimpCreateSegmentTool: ToolConfig<
  MailchimpCreateSegmentParams,
  MailchimpCreateSegmentResponse
> = {
  id: 'mailchimp_create_segment',
  name: 'Create Segment in Mailchimp Audience',
  description: 'Create a new segment in a Mailchimp audience',
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
    segmentName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the segment (e.g., "VIP Customers")',
    },
    segmentOptions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of segment options for saved segments (e.g., {"match": "all", "conditions": [...]})',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/segments`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.segmentName,
      }

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
      handleMailchimpError(data, response.status, 'create_segment')
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
      description: 'Created segment data',
      properties: {
        segment: { type: 'json', description: 'Created segment object' },
        segment_id: { type: 'string', description: 'Created segment ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
