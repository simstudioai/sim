import type { MailchimpSegment } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetSegmentParams {
  apiKey: string
  listId: string
  segmentId: string
}

export interface MailchimpGetSegmentResponse {
  success: boolean
  output: {
    segment: MailchimpSegment
    segment_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    segmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the segment (e.g., "12345")',
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
        segment_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the segment was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Segment data',
      properties: {
        segment: { type: 'json', description: 'Segment object' },
        segment_id: { type: 'string', description: 'The unique ID of the segment' },
      },
    },
  },
}
