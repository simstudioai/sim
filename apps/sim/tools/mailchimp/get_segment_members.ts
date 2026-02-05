import type { MailchimpMember } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetSegmentMembersParams {
  apiKey: string
  listId: string
  segmentId: string
  count?: string
  offset?: string
}

export interface MailchimpGetSegmentMembersResponse {
  success: boolean
  output: {
    members: MailchimpMember[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetSegmentMembersTool: ToolConfig<
  MailchimpGetSegmentMembersParams,
  MailchimpGetSegmentMembersResponse
> = {
  id: 'mailchimp_get_segment_members',
  name: 'Get Segment Members from Mailchimp',
  description: 'Retrieve members of a specific segment from a Mailchimp audience',
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
      const url = buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/segments/${params.segmentId}/members`
      )
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
      handleMailchimpError(data, response.status, 'get_segment_members')
    }

    const data = await response.json()
    const members = data.members || []

    return {
      success: true,
      output: {
        members,
        total_items: data.total_items || members.length,
        total_returned: members.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the segment members were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Segment members data',
      properties: {
        members: { type: 'json', description: 'Array of member objects' },
        total_items: { type: 'number', description: 'Total number of members' },
        total_returned: {
          type: 'number',
          description: 'Number of members returned in this response',
        },
      },
    },
  },
}
