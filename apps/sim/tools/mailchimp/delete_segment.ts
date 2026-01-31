import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteSegmentParams {
  apiKey: string
  listId: string
  segmentId: string
}

export interface MailchimpDeleteSegmentResponse {
  success: boolean
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    segmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the segment to delete (e.g., "12345")',
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
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the segment was successfully deleted' },
  },
}
